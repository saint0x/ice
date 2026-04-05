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

const MAX_SCROLLBACK_BYTES: usize = 256 * 1024;

pub struct TerminalService {
    app: AppHandle,
    persistence: Arc<PersistenceService>,
    metadata: Arc<Mutex<HashMap<String, TerminalSessionRecord>>>,
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSessionHandle>>>>,
    scrollback: Arc<Mutex<HashMap<String, String>>>,
}

struct TerminalSessionHandle {
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
    pub shell_path: String,
    pub title: String,
    pub cols: u16,
    pub rows: u16,
    pub is_running: bool,
    pub startup_command: Option<String>,
    pub env_overrides: Option<HashMap<String, String>>,
    pub restored_from_persistence: bool,
    pub last_exit_code: Option<i32>,
    pub last_exit_signal: Option<String>,
    pub last_exit_reason: Option<String>,
    pub scrollback_bytes: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScrollbackRecord {
    pub session_id: String,
    pub content: String,
}

#[derive(Debug, Clone)]
struct TerminalSpawnRequest {
    session_id: String,
    project_id: String,
    cwd: String,
    shell_path: String,
    title: String,
    cols: u16,
    rows: u16,
    startup_command: Option<String>,
    env_overrides: HashMap<String, String>,
}

impl TerminalService {
    pub fn new(app: AppHandle, persistence: Arc<PersistenceService>) -> Self {
        let mut metadata: HashMap<String, TerminalSessionRecord> = persistence
            .load_terminal_sessions_sync()
            .unwrap_or_default()
            .into_iter()
            .map(|mut session| {
                let was_running = session.is_running;
                session.is_running = false;
                session.restored_from_persistence = true;
                if was_running && session.last_exit_reason.is_none() {
                    session.last_exit_reason = Some("app_restart".to_string());
                }
                (session.session_id.clone(), session)
            })
            .collect();
        let scrollback = persistence
            .load_terminal_scrollback_sync()
            .unwrap_or_default();
        for session in metadata.values_mut() {
            session.scrollback_bytes = scrollback
                .get(&session.session_id)
                .map(|content| content.len())
                .unwrap_or(0);
            let _ = persistence.upsert_terminal_session_sync(session);
        }

        Self {
            app,
            persistence,
            metadata: Arc::new(Mutex::new(metadata)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            scrollback: Arc::new(Mutex::new(scrollback)),
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
        startup_command: Option<String>,
        env_overrides: Option<HashMap<String, String>>,
    ) -> Result<TerminalSessionRecord> {
        let shell_path = shell
            .as_deref()
            .map(resolve_shell_command)
            .unwrap_or_else(default_shell);
        let request = TerminalSpawnRequest {
            session_id: Uuid::new_v4().to_string(),
            project_id: project.id,
            cwd: cwd.unwrap_or(project.root_path),
            shell_path,
            title: title.unwrap_or_else(|| "Terminal".to_string()),
            cols,
            rows,
            startup_command,
            env_overrides: env_overrides.unwrap_or_default(),
        };
        self.spawn_session(request, false).await
    }

    pub async fn respawn(&self, session_id: &str) -> Result<TerminalSessionRecord> {
        let record = {
            let metadata = self.metadata.lock();
            metadata.get(session_id).cloned()
        };
        if let Some(record) = record {
            if record.is_running {
                return Ok(record);
            }

            let mut request = TerminalSpawnRequest {
                session_id: record.session_id.clone(),
                project_id: record.project_id.clone(),
                cwd: record.cwd.clone(),
                shell_path: resolve_shell_command(&record.shell_path),
                title: record.title.clone(),
                cols: record.cols,
                rows: record.rows,
                startup_command: record.startup_command.clone(),
                env_overrides: record.env_overrides.clone().unwrap_or_default(),
            };
            if request.shell_path.is_empty() {
                request.shell_path = default_shell();
            }
            let trimmed = {
                let mut scrollback = self.scrollback.lock();
                let existing = scrollback.entry(session_id.to_string()).or_default();
                existing.push_str("\r\n[ice] session respawned\r\n");
                let trimmed = trim_scrollback(existing);
                *existing = trimmed.clone();
                trimmed
            };
            if let Some(metadata) = self.metadata.lock().get_mut(session_id) {
                metadata.scrollback_bytes = trimmed.len();
            }
            self.persistence
                .upsert_terminal_scrollback(session_id.to_string(), trimmed)
                .await?;
            return self.spawn_session(request, false).await;
        }

        Err(anyhow!("unknown terminal session"))
    }

    pub async fn scrollback(&self, session_id: &str) -> Result<TerminalScrollbackRecord> {
        if !self.metadata.lock().contains_key(session_id) {
            return Err(anyhow!("unknown terminal session"));
        }
        let content = self
            .scrollback
            .lock()
            .get(session_id)
            .cloned()
            .unwrap_or_default();
        Ok(TerminalScrollbackRecord {
            session_id: session_id.to_string(),
            content,
        })
    }

    pub async fn write(&self, session_id: &str, data: &str) -> Result<()> {
        let handle = self.get(session_id)?;
        let mut writer = handle.writer.lock();
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }

    pub async fn interrupt(&self, session_id: &str) -> Result<()> {
        self.write(session_id, "\u{3}").await
    }

    pub async fn send_eof(&self, session_id: &str) -> Result<()> {
        self.write(session_id, "\u{4}").await
    }

    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let handle = self.get(session_id)?;
        handle.master.lock().resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let updated = self
            .update_metadata(session_id, |record| {
                record.cols = cols;
                record.rows = rows;
            })?
            .ok_or_else(|| anyhow!("unknown terminal session"))?;
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
        self.scrollback.lock().remove(session_id);
        self.persistence
            .delete_terminal_session(session_id.to_string())
            .await?;
        self.persistence
            .delete_terminal_scrollback(session_id.to_string())
            .await?;
        self.app.emit(
            TERMINAL_EVENT,
            serde_json::json!({ "type": "sessionClosed", "sessionId": session_id }),
        )?;
        Ok(())
    }

    pub async fn clear_scrollback(&self, session_id: &str) -> Result<TerminalSessionRecord> {
        if !self.metadata.lock().contains_key(session_id) {
            return Err(anyhow!("unknown terminal session"));
        }
        self.scrollback
            .lock()
            .insert(session_id.to_string(), String::new());
        let updated = self
            .update_metadata(session_id, |record| {
                record.scrollback_bytes = 0;
            })?
            .ok_or_else(|| anyhow!("unknown terminal session"))?;
        self.persistence
            .upsert_terminal_session(updated.clone())
            .await?;
        self.persistence
            .upsert_terminal_scrollback(session_id.to_string(), String::new())
            .await?;
        self.app.emit(
            TERMINAL_EVENT,
            serde_json::json!({
                "type": "scrollbackCleared",
                "sessionId": session_id,
                "session": updated.clone()
            }),
        )?;
        Ok(updated)
    }

    pub async fn rename(&self, session_id: &str, title: &str) -> Result<TerminalSessionRecord> {
        let updated = self
            .update_metadata(session_id, |record| {
                record.title = title.to_string();
            })?
            .ok_or_else(|| anyhow!("unknown terminal session"))?;
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
        self.scrollback
            .lock()
            .retain(|session_id, _| !session_ids.iter().any(|id| id == session_id));
        self.persistence
            .delete_terminal_scrollback_for_project(project_id.to_string())
            .await?;
        self.persistence
            .delete_terminal_sessions_for_project(project_id.to_string())
            .await
    }

    pub async fn shutdown(&self) -> Result<()> {
        let session_ids: Vec<String> = self.sessions.lock().keys().cloned().collect();
        for session_id in session_ids {
            if let Some(handle) = self.sessions.lock().remove(&session_id) {
                let _ = handle.child.lock().kill();
            }
            if let Some(updated) = self.update_metadata(&session_id, |record| {
                record.is_running = false;
                record.restored_from_persistence = true;
                record.last_exit_reason = Some("app_shutdown".to_string());
            })? {
                self.persistence.upsert_terminal_session(updated).await?;
            }
        }
        Ok(())
    }
}

impl TerminalService {
    async fn spawn_session(
        &self,
        request: TerminalSpawnRequest,
        restored_from_persistence: bool,
    ) -> Result<TerminalSessionRecord> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let shell_name = display_shell_name(&request.shell_path);
        let mut command = CommandBuilder::new(&request.shell_path);
        for arg in login_shell_args(&request.shell_path) {
            command.arg(arg);
        }
        command.cwd(request.cwd.clone());
        for (key, value) in &request.env_overrides {
            command.env(key, value);
        }

        let child = pair
            .slave
            .spawn_command(command)
            .context("failed to spawn shell")?;
        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        let existing_scrollback = self
            .scrollback
            .lock()
            .get(&request.session_id)
            .cloned()
            .unwrap_or_default();
        let record = TerminalSessionRecord {
            session_id: request.session_id.clone(),
            project_id: request.project_id.clone(),
            cwd: request.cwd.clone(),
            shell: shell_name,
            shell_path: request.shell_path.clone(),
            title: request.title.clone(),
            cols: request.cols,
            rows: request.rows,
            is_running: true,
            startup_command: request.startup_command.clone(),
            env_overrides: if request.env_overrides.is_empty() {
                None
            } else {
                Some(request.env_overrides.clone())
            },
            restored_from_persistence,
            last_exit_code: None,
            last_exit_signal: None,
            last_exit_reason: None,
            scrollback_bytes: existing_scrollback.len(),
        };

        let handle = Arc::new(TerminalSessionHandle {
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

        if let Some(startup_command) = request.startup_command.clone() {
            {
                let mut writer = handle.writer.lock();
                writer.write_all(startup_command.as_bytes())?;
                writer.write_all(b"\n")?;
                writer.flush()?;
            }
        }

        let app = self.app.clone();
        let persistence = self.persistence.clone();
        let metadata = self.metadata.clone();
        let sessions = self.sessions.clone();
        let scrollback = self.scrollback.clone();
        let session_id = record.session_id.clone();
        let handle_for_wait = handle.clone();
        thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        sessions.lock().remove(&session_id);
                        let exit_status = handle_for_wait
                            .child
                            .lock()
                            .try_wait()
                            .ok()
                            .flatten()
                            .or_else(|| handle_for_wait.child.lock().wait().ok());
                        if let Some(record) = metadata.lock().get_mut(&session_id) {
                            record.is_running = false;
                            record.restored_from_persistence = true;
                            record.last_exit_code =
                                exit_status.as_ref().map(|status| status.exit_code() as i32);
                            record.last_exit_signal =
                                exit_status.and_then(|status| status.signal().map(str::to_string));
                            record.last_exit_reason = Some("process_exit".to_string());
                            let persisted = record.clone();
                            let persistence = persistence.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = persistence.upsert_terminal_session(persisted).await;
                            });
                            let _ = app.emit(
                                TERMINAL_EVENT,
                                serde_json::json!({
                                  "type": "sessionExited",
                                  "session": record.clone()
                                }),
                            );
                        }
                        break;
                    }
                    Ok(size) => {
                        let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                        let (persisted_scrollback, bytes) = {
                            let mut all = scrollback.lock();
                            let existing = all.entry(session_id.clone()).or_default();
                            existing.push_str(&chunk);
                            let trimmed = trim_scrollback(existing);
                            *existing = trimmed.clone();
                            (trimmed.clone(), trimmed.len())
                        };
                        if let Some(record) = metadata.lock().get_mut(&session_id) {
                            record.scrollback_bytes = bytes;
                            let persisted = record.clone();
                            let persistence = persistence.clone();
                            let scrollback_session_id = session_id.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = persistence.upsert_terminal_session(persisted).await;
                                let _ = persistence
                                    .upsert_terminal_scrollback(
                                        scrollback_session_id,
                                        persisted_scrollback,
                                    )
                                    .await;
                            });
                        }
                        let _ = app.emit(
                            TERMINAL_EVENT,
                            serde_json::json!({
                              "type": "data",
                              "sessionId": session_id,
                              "data": chunk
                            }),
                        );
                    }
                    Err(error) => {
                        sessions.lock().remove(&session_id);
                        if let Some(record) = metadata.lock().get_mut(&session_id) {
                            record.is_running = false;
                            record.restored_from_persistence = true;
                            record.last_exit_reason = Some(format!("read_error:{error}"));
                            let persistence = persistence.clone();
                            let persisted = record.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = persistence.upsert_terminal_session(persisted).await;
                            });
                            let _ = app.emit(
                                TERMINAL_EVENT,
                                serde_json::json!({
                                  "type": "sessionReadError",
                                  "session": record.clone()
                                }),
                            );
                        }
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

    fn get(&self, session_id: &str) -> Result<Arc<TerminalSessionHandle>> {
        self.sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("unknown terminal session"))
    }

    fn update_metadata<F>(
        &self,
        session_id: &str,
        mut apply: F,
    ) -> Result<Option<TerminalSessionRecord>>
    where
        F: FnMut(&mut TerminalSessionRecord),
    {
        let updated = {
            let mut metadata = self.metadata.lock();
            let Some(record) = metadata.get_mut(session_id) else {
                return Ok(None);
            };
            apply(record);
            record.clone()
        };
        Ok(Some(updated))
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

fn resolve_shell_command(shell: &str) -> String {
    if shell.is_empty() {
        return default_shell();
    }
    if shell.starts_with('/') {
        return shell.to_string();
    }
    if let Ok(output) = StdCommand::new("which").arg(shell).output() {
        if output.status.success() {
            let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !resolved.is_empty() {
                return resolved;
            }
        }
    }
    default_shell()
}

fn display_shell_name(shell: &str) -> String {
    PathBuf::from(shell)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(shell)
        .to_string()
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

fn trim_scrollback(content: &str) -> String {
    if content.len() <= MAX_SCROLLBACK_BYTES {
        return content.to_string();
    }
    let mut start = content.len() - MAX_SCROLLBACK_BYTES;
    while start < content.len() && !content.is_char_boundary(start) {
        start += 1;
    }
    content[start..].to_string()
}

#[cfg(test)]
mod tests {
    use super::trim_scrollback;

    #[test]
    fn trims_scrollback_to_bounded_size() {
        let content = "a".repeat(300_000);
        let trimmed = trim_scrollback(&content);
        assert_eq!(trimmed.len(), 256 * 1024);
    }
}
