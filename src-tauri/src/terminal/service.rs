use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command as StdCommand;
use std::sync::Arc;
use std::thread;

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::app::events::TERMINAL_EVENT;
use crate::persistence::db::PersistenceService;
use crate::projects::models::ProjectRecord;

pub struct TerminalService {
    app: AppHandle,
    persistence: Arc<PersistenceService>,
    metadata: Arc<Mutex<HashMap<String, TerminalSessionRecord>>>,
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSessionHandle>>>>,
}

struct TerminalSessionHandle {
    record: Mutex<TerminalSessionRecord>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionRecord {
    pub session_id: String,
    pub project_id: String,
    pub cwd: String,
    pub shell: String,
    pub title: String,
    pub cols: u16,
    pub rows: u16,
    pub is_running: bool,
}

impl TerminalService {
    pub fn new(app: AppHandle, persistence: Arc<PersistenceService>) -> Self {
        let metadata = persistence
            .load_terminal_sessions_sync()
            .unwrap_or_default()
            .into_iter()
            .map(|mut session| {
                session.is_running = false;
                (session.session_id.clone(), session)
            })
            .collect();
        Self {
            app,
            persistence,
            metadata: Arc::new(Mutex::new(metadata)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn create_session(
        &self,
        project: ProjectRecord,
        cwd: Option<String>,
        shell: Option<String>,
        title: Option<String>,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalSessionRecord> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let cwd = cwd.unwrap_or_else(|| project.root_path.clone());
        let shell = shell.unwrap_or_else(default_shell);
        let shell_name = PathBuf::from(&shell)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&shell)
            .to_string();

        let mut command = CommandBuilder::new(&shell);
        for arg in login_shell_args(&shell) {
            command.arg(arg);
        }
        command.cwd(cwd.clone());

        let child = pair
            .slave
            .spawn_command(command)
            .context("failed to spawn shell")?;
        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        let record = TerminalSessionRecord {
            session_id: Uuid::new_v4().to_string(),
            project_id: project.id,
            cwd,
            shell: shell_name,
            title: title.unwrap_or_else(|| "Terminal".to_string()),
            cols,
            rows,
            is_running: true,
        };

        let handle = Arc::new(TerminalSessionHandle {
            record: Mutex::new(record.clone()),
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
        });
        self.sessions
            .lock()
            .insert(record.session_id.clone(), handle.clone());
        self.metadata
            .lock()
            .insert(record.session_id.clone(), record.clone());
        self.persistence
            .upsert_terminal_session(record.clone())
            .await?;

        let app = self.app.clone();
        let persistence = self.persistence.clone();
        let metadata = self.metadata.clone();
        let sessions = self.sessions.clone();
        let session_id = record.session_id.clone();
        thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        sessions.lock().remove(&session_id);
                        if let Some(record) = metadata.lock().get_mut(&session_id) {
                            record.is_running = false;
                            let persistence = persistence.clone();
                            let record = record.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = persistence.upsert_terminal_session(record).await;
                            });
                        }
                        let _ = app.emit(
                            TERMINAL_EVENT,
                            serde_json::json!({ "type": "sessionExited", "sessionId": session_id }),
                        );
                        break;
                    }
                    Ok(size) => {
                        let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                        let _ = app.emit(
                            TERMINAL_EVENT,
                            serde_json::json!({
                              "type": "data",
                              "sessionId": session_id,
                              "data": chunk
                            }),
                        );
                    }
                    Err(_) => {
                        sessions.lock().remove(&session_id);
                        if let Some(record) = metadata.lock().get_mut(&session_id) {
                            record.is_running = false;
                            let persistence = persistence.clone();
                            let record = record.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = persistence.upsert_terminal_session(record).await;
                            });
                        }
                        let _ = app.emit(
                            TERMINAL_EVENT,
                            serde_json::json!({ "type": "sessionReadError", "sessionId": session_id }),
                        );
                        break;
                    }
                }
            }
        });

        self.app.emit(
            TERMINAL_EVENT,
            serde_json::json!({ "type": "sessionCreated", "session": record.clone() }),
        )?;
        Ok(record)
    }

    pub async fn write(&self, session_id: &str, data: &str) -> Result<()> {
        let handle = self.get(session_id)?;
        let mut writer = handle.writer.lock();
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }

    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let handle = self.get(session_id)?;
        handle.master.lock().resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let updated = {
            let mut record = handle.record.lock();
            record.cols = cols;
            record.rows = rows;
            record.clone()
        };
        if let Some(metadata) = self.metadata.lock().get_mut(session_id) {
            metadata.cols = cols;
            metadata.rows = rows;
        }
        self.persistence.upsert_terminal_session(updated).await?;
        Ok(())
    }

    pub async fn close(&self, session_id: &str) -> Result<()> {
        if let Some(handle) = self.sessions.lock().remove(session_id) {
            let _ = handle.child.lock().kill();
        } else if !self.metadata.lock().contains_key(session_id) {
            return Err(anyhow!("unknown terminal session"));
        }
        self.metadata.lock().remove(session_id);
        self.persistence
            .delete_terminal_session(session_id.to_string())
            .await?;
        self.app.emit(
            TERMINAL_EVENT,
            serde_json::json!({ "type": "sessionClosed", "sessionId": session_id }),
        )?;
        Ok(())
    }

    pub async fn rename(&self, session_id: &str, title: &str) -> Result<TerminalSessionRecord> {
        let mut updated = if let Some(handle) = self.sessions.lock().get(session_id).cloned() {
            let mut record = handle.record.lock();
            record.title = title.to_string();
            record.clone()
        } else {
            let mut metadata = self.metadata.lock();
            let record = metadata
                .get_mut(session_id)
                .ok_or_else(|| anyhow!("unknown terminal session"))?;
            record.title = title.to_string();
            record.clone()
        };
        if let Some(metadata) = self.metadata.lock().get_mut(session_id) {
            metadata.title = updated.title.clone();
            updated = metadata.clone();
        }
        self.persistence
            .upsert_terminal_session(updated.clone())
            .await?;
        self.app.emit(
            TERMINAL_EVENT,
            serde_json::json!({ "type": "sessionRenamed", "session": updated.clone() }),
        )?;
        Ok(updated)
    }

    pub async fn list(&self, project_id: Option<&str>) -> Vec<TerminalSessionRecord> {
        self.metadata
            .lock()
            .values()
            .cloned()
            .filter(|session| {
                project_id
                    .map(|id| id == session.project_id)
                    .unwrap_or(true)
            })
            .collect()
    }

    pub async fn remove_project_sessions(&self, project_id: &str) -> Result<()> {
        let session_ids: Vec<String> = self
            .metadata
            .lock()
            .values()
            .filter(|session| session.project_id == project_id)
            .map(|session| session.session_id.clone())
            .collect();

        for session_id in &session_ids {
            if let Some(handle) = self.sessions.lock().remove(session_id) {
                let _ = handle.child.lock().kill();
            }
        }
        self.metadata
            .lock()
            .retain(|_, session| session.project_id != project_id);
        self.persistence
            .delete_terminal_sessions_for_project(project_id.to_string())
            .await
    }
}

impl TerminalService {
    fn get(&self, session_id: &str) -> Result<Arc<TerminalSessionHandle>> {
        self.sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("unknown terminal session"))
    }
}

fn default_shell() -> String {
    resolve_login_shell().unwrap_or_else(|| "/bin/zsh".to_string())
}

fn resolve_login_shell() -> Option<String> {
    if let Ok(output) = StdCommand::new("dscl")
        .args([".", "-read", "/Users/deepsaint", "UserShell"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(value) = stdout.trim().strip_prefix("UserShell:") {
                let shell = value.trim();
                if !shell.is_empty() {
                    return Some(shell.to_string());
                }
            }
        }
    }

    std::env::var("SHELL")
        .ok()
        .filter(|value| !value.is_empty())
}

fn login_shell_args(shell: &str) -> &'static [&'static str] {
    match PathBuf::from(shell)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
    {
        "bash" | "zsh" | "sh" => &["-l"],
        "fish" => &["--login"],
        "nu" => &["-l"],
        _ => &[],
    }
}
