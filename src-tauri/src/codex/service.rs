use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::Path;
use std::process::Command as StdCommand;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::app::events::CODEX_EVENT;
use crate::app::paths::IcePaths;
use crate::persistence::db::PersistenceService;
use crate::projects::models::ProjectCodexSidebarItem;
use crate::projects::models::ProjectRecord;
use crate::security::approvals::{
    apply_approval_policy, classify_approval, enforce_project_scope_policy, PendingApprovalRecord,
    SecurityService,
};

const CODEX_MODEL_ID: &str = "gpt-5.4";

pub struct CodexService {
    app: AppHandle,
    persistence: Arc<PersistenceService>,
    paths: IcePaths,
    security: Arc<SecurityService>,
    state: Arc<Mutex<CodexRuntimeState>>,
    next_id: AtomicU64,
}

#[derive(Default)]
struct CodexRuntimeState {
    process: Option<CodexProcess>,
    threads: HashMap<String, CodexThreadBinding>,
    loaded_threads: HashMap<String, bool>,
    pending_server_requests: HashMap<u64, String>,
    recent_stderr: VecDeque<String>,
}

struct CodexProcess {
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>>,
    child: Arc<tokio::sync::Mutex<Child>>,
}

impl Clone for CodexProcess {
    fn clone(&self) -> Self {
        Self {
            stdin: self.stdin.clone(),
            pending_requests: self.pending_requests.clone(),
            child: self.child.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStatus {
    pub running: bool,
    pub available: bool,
    pub thread_count: usize,
    pub runtime_info: Option<CodexRuntimeInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModel {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRuntimeInfo {
    pub cli_version: Option<String>,
    pub app_server_default_listen: Option<String>,
    pub supports_generate_json_schema: bool,
    pub supports_generate_ts: bool,
    pub schema_sha256: Option<String>,
    pub schema_bytes: Option<usize>,
    pub schema_title: Option<String>,
    pub schema_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexThreadBinding {
    pub project_id: String,
    pub thread_id: String,
    pub title: Option<String>,
    pub model: Option<String>,
    pub status: String,
    pub last_turn_id: Option<String>,
    pub last_assistant_message: Option<String>,
    pub unread: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexMessageRecord {
    pub message_id: String,
    pub project_id: String,
    pub thread_id: String,
    pub turn_id: Option<String>,
    pub role: String,
    pub content: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub(crate) struct CodexMessageUpdate {
    pub message_id: String,
    pub project_id: String,
    pub thread_id: String,
    pub turn_id: Option<String>,
    pub role: String,
    pub content: String,
    pub state: String,
    pub append: bool,
}

impl CodexService {
    pub fn new(
        app: AppHandle,
        persistence: Arc<PersistenceService>,
        paths: IcePaths,
        security: Arc<SecurityService>,
    ) -> Self {
        let persisted_threads = persistence.load_codex_threads_sync().unwrap_or_default();
        let orphaned_thread_ids = persisted_threads
            .iter()
            .filter(|thread| !thread_has_backing_session(&paths, &thread.thread_id))
            .map(|thread| thread.thread_id.clone())
            .collect::<Vec<_>>();
        for thread_id in orphaned_thread_ids {
            let _ = persistence.delete_codex_thread_sync(&thread_id);
        }
        let superseded_disconnected_thread_ids =
            find_superseded_disconnected_thread_ids(&persisted_threads);
        for thread_id in &superseded_disconnected_thread_ids {
            let _ = persistence.delete_codex_thread_sync(thread_id);
        }
        let _ = persistence.delete_scoped_prompt_assistant_messages_sync();
        let _ = persistence.delete_empty_assistant_messages_sync();
        let persisted_threads = persisted_threads
            .into_iter()
            .filter(|thread| thread_has_backing_session(&paths, &thread.thread_id))
            .filter(|thread| !superseded_disconnected_thread_ids.contains(&thread.thread_id))
            .map(normalize_thread_after_startup)
            .collect::<Vec<_>>();
        for thread in &persisted_threads {
            let _ = tauri::async_runtime::block_on(persistence.upsert_codex_thread(thread.clone()));
        }
        let threads = persisted_threads
            .into_iter()
            .map(|thread| (thread.thread_id.clone(), thread))
            .collect();
        Self {
            app,
            persistence,
            paths,
            security,
            state: Arc::new(Mutex::new(CodexRuntimeState {
                process: None,
                threads,
                loaded_threads: HashMap::new(),
                pending_server_requests: HashMap::new(),
                recent_stderr: VecDeque::new(),
            })),
            next_id: AtomicU64::new(1),
        }
    }

    pub async fn codex_available(&self) -> bool {
        Command::new("codex")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false)
    }

    pub async fn status(&self) -> CodexStatus {
        let available = self.codex_available().await;
        let runtime_info = self.runtime_info_cached().await;
        let state = self.state.lock();
        CodexStatus {
            running: state.process.is_some(),
            available,
            thread_count: state.threads.len(),
            runtime_info,
        }
    }

    pub async fn prewarm(&self) -> Result<()> {
        let _ = self.runtime_info().await;
        let _ = self.ensure_process().await?;
        Ok(())
    }

    pub async fn runtime_info(&self) -> Result<CodexRuntimeInfo> {
        let info = inspect_codex_runtime_info().await?;
        self.persistence
            .config_set(
                "codex.runtimeInfo".to_string(),
                serde_json::to_value(&info)?,
            )
            .await?;
        Ok(info)
    }

    pub async fn runtime_info_cached(&self) -> Option<CodexRuntimeInfo> {
        self.persistence
            .config_get("codex.runtimeInfo")
            .await
            .ok()
            .flatten()
            .and_then(|value| serde_json::from_value(value).ok())
    }

    pub async fn models_list(&self) -> Result<Vec<CodexModel>> {
        let result = self
            .request(
                "model/list",
                json!({
                  "limit": 100,
                  "includeHidden": false
                }),
            )
            .await?;
        let data = result
            .get("data")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(data
            .into_iter()
            .filter_map(|item| {
                let id = item.get("id")?.as_str()?.to_string();
                if id != CODEX_MODEL_ID {
                    return None;
                }
                Some(CodexModel {
                    id,
                    display_name: item
                        .get("displayName")
                        .or_else(|| item.get("display_name"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("GPT-5.4")
                        .to_string(),
                    is_default: true,
                })
            })
            .collect())
    }

    pub async fn auth_read(&self) -> Result<Value> {
        self.request("account/read", json!({ "refreshToken": false }))
            .await
    }

    pub async fn login_start(
        &self,
        mode: Option<String>,
        api_key: Option<String>,
    ) -> Result<Value> {
        let mode = mode.unwrap_or_else(|| "chatgpt".to_string());
        let params = match mode.as_str() {
            "apikey" | "apiKey" => json!({ "mode": "apiKey", "apiKey": api_key }),
            "chatgptAuthTokens" => json!({ "mode": "chatgptAuthTokens" }),
            _ => json!({ "mode": "chatgpt" }),
        };
        self.request("account/login/start", params).await
    }

    pub async fn thread_create(
        &self,
        project_id: String,
        title: Option<String>,
        _model: Option<String>,
    ) -> Result<CodexThreadBinding> {
        let project = self.require_project(&project_id).await?;
        let model = Some(CODEX_MODEL_ID.to_string());
        let result = self
            .request(
                "thread/start",
                json!({
                  "cwd": project.root_path,
                  "approvalPolicy": "never",
                  "sandbox": "danger-full-access",
                  "model": CODEX_MODEL_ID,
                  "serviceName": "ice"
                }),
            )
            .await
            .with_context(|| {
                format!(
                    "unable to create Codex thread for project '{}'",
                    project.name
                )
            })?;
        let thread_id = result
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .and_then(|value| value.as_str())
            .unwrap_or_else(|| Uuid::new_v4().to_string().leak())
            .to_string();
        let binding = CodexThreadBinding {
            project_id,
            thread_id: thread_id.clone(),
            title,
            model,
            status: "idle".to_string(),
            last_turn_id: None,
            last_assistant_message: None,
            unread: false,
        };
        {
            let mut state = self.state.lock();
            state.loaded_threads.insert(thread_id.clone(), true);
            state.threads.insert(thread_id, binding.clone());
        }
        self.persistence
            .upsert_codex_thread(binding.clone())
            .await?;
        let _ = self.app.emit(
            CODEX_EVENT,
            json!({ "type": "threadCreated", "thread": binding.clone() }),
        );
        Ok(binding)
    }

    pub async fn turn_start(
        &self,
        project_id: String,
        thread_id: String,
        prompt: String,
        _model: Option<String>,
    ) -> Result<Value> {
        let project = self.require_project(&project_id).await?;
        let existing_thread = self.require_thread_in_project(&project_id, &thread_id)?;
        self.ensure_thread_loaded(&project, &existing_thread)
            .await?;
        let scoped_prompt = build_scoped_turn_prompt(&project, &prompt);
        let result = self
            .request(
                "turn/start",
                json!({
                  "threadId": thread_id,
                  "cwd": project.root_path,
                  "approvalPolicy": "never",
                  "sandboxPolicy": {
                    "type": "dangerFullAccess"
                  },
                  "model": CODEX_MODEL_ID,
                  "effort": "medium",
                  "summary": "concise",
                  "input": [
                    {
                      "type": "text",
                      "text": scoped_prompt
                    }
                  ]
                }),
            )
            .await
            .with_context(|| {
                format!(
                    "unable to start Codex turn for project '{}' in thread '{}'",
                    project.name, thread_id
                )
            });
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                if is_missing_thread_error(&error) {
                    self.drop_stale_thread(&thread_id).await;
                }
                return Err(error);
            }
        };
        let updated_binding = {
            let mut state = self.state.lock();
            if let Some(binding) = state.threads.get_mut(&thread_id) {
                binding.project_id = existing_thread.project_id.clone();
                binding.status = "running".to_string();
                binding.unread = false;
                binding.last_turn_id = result
                    .get("turn")
                    .and_then(|turn| turn.get("id"))
                    .and_then(|value| value.as_str())
                    .map(ToOwned::to_owned);
                let cloned = binding.clone();
                state.loaded_threads.insert(thread_id.clone(), true);
                Some(cloned)
            } else {
                None
            }
        };
        let turn_id = updated_binding
            .as_ref()
            .and_then(|binding| binding.last_turn_id.clone());
        if let Some(binding) = updated_binding {
            self.persistence
                .upsert_codex_thread(binding.clone())
                .await?;
            let _ = self.app.emit(
                CODEX_EVENT,
                json!({ "type": "threadUpdated", "thread": binding }),
            );
        }
        let prompt_message = self
            .persistence
            .upsert_codex_message(new_codex_message(
                project_id,
                thread_id.clone(),
                turn_id,
                "user",
                prompt,
                "complete",
            ))
            .await?;
        let _ = self.app.emit(
            CODEX_EVENT,
            json!({ "type": "messageUpserted", "message": prompt_message }),
        );
        Ok(result)
    }

    pub async fn list_threads(&self, project_id: Option<&str>) -> Vec<CodexThreadBinding> {
        let persisted = {
            let persistence = self.persistence.clone();
            tokio::task::spawn_blocking(move || persistence.load_codex_threads_sync())
                .await
                .ok()
                .and_then(Result::ok)
                .unwrap_or_default()
        };
        let runtime_threads = self.state.lock().threads.clone();
        let mut ordered = persisted
            .into_iter()
            .filter_map(|thread| runtime_threads.get(&thread.thread_id).cloned())
            .collect::<Vec<_>>();
        for thread in runtime_threads.values() {
            if ordered
                .iter()
                .any(|existing| existing.thread_id == thread.thread_id)
            {
                continue;
            }
            ordered.push(thread.clone());
        }
        ordered.retain(|thread| {
            project_id
                .map(|candidate| thread.project_id == candidate)
                .unwrap_or(true)
        });
        ordered
    }

    pub async fn thread_messages_in_project(
        &self,
        project_id: &str,
        thread_id: &str,
    ) -> Result<Vec<CodexMessageRecord>> {
        let binding = self.require_thread_in_project(project_id, thread_id)?;
        self.persistence
            .list_codex_messages_for_thread(thread_id.to_string())
            .await
            .map(|messages| {
                messages
                    .into_iter()
                    .filter(|message| message.project_id == binding.project_id)
                    .collect()
            })
    }

    pub async fn sidebar_threads(&self, project_id: &str) -> Vec<ProjectCodexSidebarItem> {
        let mut items = self
            .list_threads(Some(project_id))
            .await
            .into_iter()
            .map(|thread| ProjectCodexSidebarItem {
                thread_id: thread.thread_id.clone(),
                title: thread
                    .title
                    .clone()
                    .unwrap_or_else(|| "New Thread".to_string()),
                status: thread.status.clone(),
                unread: thread.unread,
                last_assistant_message: thread.last_assistant_message.clone(),
            })
            .collect::<Vec<_>>();
        items.sort_by(|left, right| right.unread.cmp(&left.unread));
        items
    }

    pub async fn respond_to_server_request(&self, request_id: u64, result: Value) -> Result<()> {
        let process = self.ensure_process().await?;
        let resolved = self
            .security
            .resolve_approval(request_id, "approved")
            .await?;
        if let Some(thread) = mark_thread_after_approval_response(
            &self.state,
            resolved.as_ref().and_then(|a| a.thread_id.as_deref()),
        ) {
            self.persistence.upsert_codex_thread(thread.clone()).await?;
            let _ = self.app.emit(
                CODEX_EVENT,
                json!({ "type": "threadUpdated", "thread": thread }),
            );
        }
        self.state
            .lock()
            .pending_server_requests
            .remove(&request_id);
        let payload = json!({ "id": request_id, "result": result });
        let mut stdin = process.stdin.lock().await;
        stdin.write_all(payload.to_string().as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    pub async fn deny_server_request(
        &self,
        request_id: u64,
        message: Option<String>,
    ) -> Result<()> {
        let process = self.ensure_process().await?;
        let resolved = self.security.resolve_approval(request_id, "denied").await?;
        if let Some(thread) = mark_thread_after_denial(
            &self.state,
            resolved
                .as_ref()
                .and_then(|approval| approval.thread_id.as_deref()),
        ) {
            self.persistence.upsert_codex_thread(thread.clone()).await?;
            let _ = self.app.emit(
                CODEX_EVENT,
                json!({ "type": "threadUpdated", "thread": thread }),
            );
        }
        self.state
            .lock()
            .pending_server_requests
            .remove(&request_id);
        let payload = json!({
            "id": request_id,
            "error": {
                "code": -32001,
                "message": message.unwrap_or_else(|| "Approval denied by user".to_string())
            }
        });
        let mut stdin = process.stdin.lock().await;
        stdin.write_all(payload.to_string().as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    pub async fn restart_process(&self) -> Result<CodexStatus> {
        let existing_process = {
            let mut state = self.state.lock();
            state.process.take()
        };
        if let Some(process) = existing_process {
            let mut child = process.child.lock().await;
            let _ = child.kill().await;
            let _ = child.wait().await;
        }

        let disconnected_threads = {
            let mut runtime = self.state.lock();
            runtime.loaded_threads.clear();
            runtime.pending_server_requests.clear();
            runtime
                .threads
                .values_mut()
                .filter_map(|thread| {
                    if matches!(
                        thread.status.as_str(),
                        "running" | "waitingApproval" | "disconnected"
                    ) {
                        thread.status = "disconnected".to_string();
                        Some(thread.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        };
        for thread in disconnected_threads {
            self.persistence.upsert_codex_thread(thread.clone()).await?;
            let _ = self.app.emit(
                CODEX_EVENT,
                json!({ "type": "threadUpdated", "thread": thread }),
            );
        }
        self.ensure_process().await?;
        Ok(self.status().await)
    }

    pub async fn thread_count(&self, project_id: &str) -> usize {
        self.state
            .lock()
            .threads
            .values()
            .filter(|binding| binding.project_id == project_id)
            .count()
    }

    pub async fn remove_project_threads(&self, project_id: &str) -> Result<()> {
        {
            let mut state = self.state.lock();
            state
                .threads
                .retain(|_, thread| thread.project_id != project_id);
            let live_thread_ids = state.threads.keys().cloned().collect::<Vec<_>>();
            state
                .loaded_threads
                .retain(|thread_id, _| live_thread_ids.iter().any(|id| id == thread_id));
        }
        self.persistence
            .delete_codex_threads_for_project(project_id.to_string())
            .await
    }

    async fn drop_stale_thread(&self, thread_id: &str) {
        let removed = {
            let mut state = self.state.lock();
            state.loaded_threads.remove(thread_id);
            state.threads.remove(thread_id)
        };
        if removed.is_none() {
            return;
        }
        let _ = self
            .persistence
            .delete_codex_thread(thread_id.to_string())
            .await;
    }

    async fn ensure_process(&self) -> Result<CodexProcess> {
        let existing_process = {
            let state = self.state.lock();
            state.process.as_ref().cloned()
        };
        if let Some(process) = existing_process {
            if process_is_alive(&process).await {
                return Ok(process);
            }
            self.reset_process_state("The Codex app server process exited unexpectedly.")
                .await?;
        }

        let mut child = Command::new("codex")
            .arg("app-server")
            .env("CODEX_HOME", self.paths.concern_dir("codex"))
            .env("SHELL", resolve_login_shell())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to start codex app-server")?;

        let stdin = child.stdin.take().context("missing codex stdin")?;
        let stdout = child.stdout.take().context("missing codex stdout")?;
        let stderr = child.stderr.take().context("missing codex stderr")?;

        let process = CodexProcess {
            stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            child: Arc::new(tokio::sync::Mutex::new(child)),
        };

        self.spawn_reader(stdout, stderr, process.clone());
        self.state.lock().process = Some(process.clone());
        self.initialize_process(&process).await?;
        let _ = self
            .app
            .emit(CODEX_EVENT, json!({ "type": "serverConnected" }));
        Ok(process)
    }

    async fn initialize_process(&self, process: &CodexProcess) -> Result<()> {
        let init_id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        process.pending_requests.lock().insert(init_id, tx);
        self.write_to_process(
            process,
            json!({
              "id": init_id,
              "method": "initialize",
              "params": {
                "clientInfo": {
                  "name": "ice",
                  "title": "Ice",
                  "version": "0.1.0"
                }
              }
            }),
        )
        .await?;
        let _ = rx.await.with_context(|| {
            format!(
                "Codex app-server closed the initialize response channel{}",
                self.recent_stderr_suffix()
            )
        })??;
        self.write_to_process(
            process,
            json!({
              "method": "initialized",
              "params": {}
            }),
        )
        .await
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value> {
        match self.request_once(method, params.clone()).await {
            Ok(result) => Ok(result),
            Err(error) if is_transport_failure(&error) => {
                self.reset_process_state(
                    "The Codex app server became unresponsive during a request.",
                )
                .await?;
                self.request_once(method, params).await.with_context(|| {
                    format!("Codex request '{method}' failed after process restart")
                })
            }
            Err(error) => Err(error),
        }
    }

    async fn request_once(&self, method: &str, params: Value) -> Result<Value> {
        let process = self.ensure_process().await?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        process.pending_requests.lock().insert(id, tx);

        let payload = json!({
            "id": id,
            "method": method,
            "params": params
        });
        self.write_to_process(&process, payload).await?;

        rx.await.with_context(|| {
            format!(
                "Codex app-server closed the response channel for '{}'{}",
                method,
                self.recent_stderr_suffix()
            )
        })?
    }

    async fn write_to_process(&self, process: &CodexProcess, payload: Value) -> Result<()> {
        let mut stdin = process.stdin.lock().await;
        stdin.write_all(payload.to_string().as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    fn recent_stderr_suffix(&self) -> String {
        let stderr = {
            let state = self.state.lock();
            state
                .recent_stderr
                .iter()
                .rev()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
        };
        if stderr.is_empty() {
            String::new()
        } else {
            format!("; recent Codex stderr: {}", stderr.join(" | "))
        }
    }

    fn spawn_reader(&self, stdout: ChildStdout, stderr: ChildStderr, process: CodexProcess) {
        let app = self.app.clone();
        let persistence = self.persistence.clone();
        let state = self.state.clone();
        let security = self.security.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if let Some(id) = value.get("id").and_then(|value| value.as_u64()) {
                        if value.get("method").is_some() {
                            let method = value
                                .get("method")
                                .and_then(|value| value.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let approval = {
                                let mut runtime = state.lock();
                                runtime.pending_server_requests.insert(id, method.clone());
                                build_pending_approval(id, &method, &value, &runtime.threads)
                            };
                            if let Some(approval) = approval {
                                let scoped_approval = if approval.project_id != "global" {
                                    match persistence
                                        .read_project(approval.project_id.clone())
                                        .await
                                        .ok()
                                        .flatten()
                                    {
                                        Some(project) => {
                                            if let Some(reason) = enforce_project_scope_policy(
                                                &approval,
                                                std::path::Path::new(&project.root_path),
                                            ) {
                                                Some(PendingApprovalRecord {
                                                    policy_action: "block".to_string(),
                                                    policy_reason: Some(reason),
                                                    ..approval.clone()
                                                })
                                            } else {
                                                Some(approval.clone())
                                            }
                                        }
                                        None => Some(PendingApprovalRecord {
                                            policy_action: "block".to_string(),
                                            policy_reason: Some(
                                                "Blocked action for unknown project scope"
                                                    .to_string(),
                                            ),
                                            ..approval.clone()
                                        }),
                                    }
                                } else {
                                    Some(PendingApprovalRecord {
                                        policy_action: "block".to_string(),
                                        policy_reason: Some(
                                            "Blocked action without project scope".to_string(),
                                        ),
                                        ..approval.clone()
                                    })
                                };
                                let approval = scoped_approval.unwrap_or(approval);
                                if approval.policy_action == "block" {
                                    let _ = security.record_policy_block(approval.clone()).await;
                                    if let Some(thread) = mark_thread_after_denial(
                                        &state,
                                        approval.thread_id.as_deref(),
                                    ) {
                                        let _ =
                                            persistence.upsert_codex_thread(thread.clone()).await;
                                        let _ = app.emit(
                                            CODEX_EVENT,
                                            json!({ "type": "threadUpdated", "thread": thread }),
                                        );
                                    }
                                    let payload = json!({
                                        "id": approval.request_id,
                                        "error": {
                                            "code": -32002,
                                            "message": approval
                                                .policy_reason
                                                .clone()
                                                .unwrap_or_else(|| "Blocked by backend safety policy".to_string())
                                        }
                                    });
                                    if let Ok(mut stdin) = process.stdin.try_lock() {
                                        let _ =
                                            stdin.write_all(payload.to_string().as_bytes()).await;
                                        let _ = stdin.write_all(b"\n").await;
                                        let _ = stdin.flush().await;
                                    }
                                    let _ = app.emit(
                                        CODEX_EVENT,
                                        json!({ "type": "approvalBlocked", "approval": approval }),
                                    );
                                    continue;
                                }
                                if let Some(thread) = update_thread_for_approval_request(
                                    &state,
                                    approval.thread_id.as_deref(),
                                ) {
                                    let _ = persistence.upsert_codex_thread(thread.clone()).await;
                                    let _ = app.emit(
                                        CODEX_EVENT,
                                        json!({ "type": "threadUpdated", "thread": thread }),
                                    );
                                }
                                let _ = security.upsert_approval(approval.clone()).await;
                                let _ = app.emit(
                                    CODEX_EVENT,
                                    json!({ "type": "approvalPending", "approval": approval }),
                                );
                            }
                            let _ = app.emit(
                                CODEX_EVENT,
                                json!({ "type": "serverRequest", "payload": value }),
                            );
                            continue;
                        }

                        if let Some(sender) = process.pending_requests.lock().remove(&id) {
                            let result = if let Some(error) = value.get("error") {
                                let code = error
                                    .get("code")
                                    .and_then(|value| value.as_i64())
                                    .map(|code| format!(" (code {code})"))
                                    .unwrap_or_default();
                                let message = error
                                    .get("message")
                                    .and_then(|value| value.as_str())
                                    .unwrap_or_else(|| {
                                        error
                                            .as_str()
                                            .unwrap_or("Codex app-server returned an error")
                                    });
                                let stderr_suffix = {
                                    let runtime = state.lock();
                                    let stderr = runtime
                                        .recent_stderr
                                        .iter()
                                        .rev()
                                        .take(3)
                                        .cloned()
                                        .collect::<Vec<_>>();
                                    if stderr.is_empty() {
                                        String::new()
                                    } else {
                                        format!("; recent Codex stderr: {}", stderr.join(" | "))
                                    }
                                };
                                Err(anyhow!("{message}{code}{stderr_suffix}"))
                            } else {
                                Ok(value.get("result").cloned().unwrap_or(Value::Null))
                            };
                            let _ = sender.send(result);
                        }
                    } else {
                        if let Some(outcome) = apply_notification_to_threads(&state, &value) {
                            if let Some(message_update) = outcome.message_update {
                                if let Ok(message) =
                                    persistence.apply_codex_message_update(message_update).await
                                {
                                    let _ = app.emit(
                                        CODEX_EVENT,
                                        json!({ "type": "messageUpserted", "message": message }),
                                    );
                                }
                            }
                            let thread = outcome.thread;
                            if is_terminal_thread_status(&thread.status) {
                                if let Ok(messages) = persistence
                                    .finalize_streaming_codex_messages(
                                        thread.thread_id.clone(),
                                        thread.last_turn_id.clone(),
                                    )
                                    .await
                                {
                                    for message in messages {
                                        let _ = app.emit(
                                            CODEX_EVENT,
                                            json!({ "type": "messageUpserted", "message": message }),
                                        );
                                    }
                                }
                            }
                            let _ = persistence.upsert_codex_thread(thread.clone()).await;
                            let _ = app.emit(
                                CODEX_EVENT,
                                json!({ "type": "threadUpdated", "thread": thread }),
                            );
                        }
                        let _ = app.emit(
                            CODEX_EVENT,
                            json!({ "type": "notification", "payload": value }),
                        );
                    }
                } else {
                    push_codex_runtime_line(&state, line.clone());
                    let _ = app.emit(CODEX_EVENT, json!({ "type": "stderr", "line": line }));
                }
            }
            let disconnected_threads = reset_runtime_state(&state);
            for thread in disconnected_threads {
                let _ = persistence.upsert_codex_thread(thread).await;
            }
            let _ = app.emit(
                CODEX_EVENT,
                json!({
                    "type": "serverDisconnected",
                    "reason": "The Codex app server disconnected.",
                    "recentLines": recent_runtime_lines(&state, 5),
                }),
            );
        });

        let app = self.app.clone();
        let state_for_stderr = self.state.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                push_codex_runtime_line(&state_for_stderr, line.clone());
                let _ = app.emit(CODEX_EVENT, json!({ "type": "stderr", "line": line }));
            }
        });
    }

    async fn reset_process_state(&self, message: &str) -> Result<()> {
        let disconnected_threads = reset_runtime_state(&self.state);
        for thread in disconnected_threads {
            self.persistence.upsert_codex_thread(thread).await?;
        }
        let _ = self.app.emit(
            CODEX_EVENT,
            json!({
                "type": "serverDisconnected",
                "reason": message,
                "recentLines": recent_runtime_lines(&self.state, 5),
            }),
        );
        Ok(())
    }
}

fn thread_has_backing_session(paths: &IcePaths, thread_id: &str) -> bool {
    codex_sessions_dir(paths)
        .map(|root| find_thread_session_file(&root, thread_id))
        .unwrap_or(false)
}

fn codex_sessions_dir(paths: &IcePaths) -> Option<std::path::PathBuf> {
    let root = paths.concern_dir("codex").join("sessions");
    root.is_dir().then_some(root)
}

fn find_thread_session_file(root: &Path, thread_id: &str) -> bool {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(file_type) if file_type.is_dir() => {
                if find_thread_session_file(&path, thread_id) {
                    return true;
                }
            }
            Ok(file_type) if file_type.is_file() => {
                if path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.contains(thread_id))
                    .unwrap_or(false)
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn is_missing_thread_error(error: &anyhow::Error) -> bool {
    error
        .to_string()
        .to_ascii_lowercase()
        .contains("thread not found")
}

impl CodexService {
    async fn require_project(&self, project_id: &str) -> Result<ProjectRecord> {
        self.persistence
            .read_project(project_id.to_string())
            .await?
            .ok_or_else(|| anyhow!("unknown project {project_id}"))
    }

    fn require_thread(&self, thread_id: &str) -> Result<CodexThreadBinding> {
        self.state
            .lock()
            .threads
            .get(thread_id)
            .cloned()
            .ok_or_else(|| anyhow!("unknown thread {thread_id}"))
    }

    fn require_thread_in_project(
        &self,
        project_id: &str,
        thread_id: &str,
    ) -> Result<CodexThreadBinding> {
        let binding = self.require_thread(thread_id)?;
        if binding.project_id != project_id {
            return Err(anyhow!(
                "thread {thread_id} does not belong to project {project_id}"
            ));
        }
        Ok(binding)
    }

    async fn ensure_thread_loaded(
        &self,
        project: &ProjectRecord,
        thread: &CodexThreadBinding,
    ) -> Result<()> {
        if self
            .state
            .lock()
            .loaded_threads
            .get(&thread.thread_id)
            .copied()
            .unwrap_or(false)
        {
            return Ok(());
        }
        let resume_result = self
            .request(
                "thread/resume",
                json!({
                  "threadId": thread.thread_id,
                  "cwd": project.root_path,
                  "approvalPolicy": "never",
                  "sandbox": "danger-full-access",
                  "model": CODEX_MODEL_ID,
                  "serviceName": "ice",
                }),
            )
            .await;
        if let Err(error) = resume_result {
            if is_missing_thread_error(&error) {
                self.drop_stale_thread(&thread.thread_id).await;
            }
            return Err(error).with_context(|| {
                format!(
                    "unable to resume Codex thread '{}' for project '{}'",
                    thread.thread_id, project.name
                )
            });
        }
        self.state
            .lock()
            .loaded_threads
            .insert(thread.thread_id.clone(), true);
        Ok(())
    }
}

fn resolve_login_shell() -> String {
    if let Ok(output) = StdCommand::new("dscl")
        .args([".", "-read", "/Users/deepsaint", "UserShell"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(value) = stdout.trim().strip_prefix("UserShell:") {
                let shell = value.trim();
                if !shell.is_empty() {
                    return shell.to_string();
                }
            }
        }
    }

    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

async fn process_is_alive(process: &CodexProcess) -> bool {
    let mut child = process.child.lock().await;
    matches!(child.try_wait(), Ok(None))
}

fn push_codex_runtime_line(state: &Arc<Mutex<CodexRuntimeState>>, line: String) {
    let mut runtime = state.lock();
    runtime.recent_stderr.push_back(line);
    while runtime.recent_stderr.len() > 20 {
        runtime.recent_stderr.pop_front();
    }
}

fn recent_runtime_lines(state: &Arc<Mutex<CodexRuntimeState>>, limit: usize) -> Vec<String> {
    let runtime = state.lock();
    runtime
        .recent_stderr
        .iter()
        .rev()
        .take(limit)
        .cloned()
        .collect::<Vec<_>>()
}

fn reset_runtime_state(state: &Arc<Mutex<CodexRuntimeState>>) -> Vec<CodexThreadBinding> {
    let mut runtime = state.lock();
    runtime.process = None;
    runtime.loaded_threads.clear();
    runtime.pending_server_requests.clear();
    runtime
        .threads
        .values_mut()
        .filter_map(|thread| {
            if matches!(thread.status.as_str(), "running" | "waitingApproval") {
                thread.status = "disconnected".to_string();
                Some(thread.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
}

fn is_transport_failure(error: &anyhow::Error) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("closed the response channel")
        || message.contains("closed the initialize response channel")
        || message.contains("broken pipe")
        || message.contains("connection reset")
        || message.contains("failed to start codex app-server")
        || message.contains("missing codex stdin")
        || message.contains("missing codex stdout")
        || message.contains("missing codex stderr")
}

fn normalize_thread_after_startup(mut thread: CodexThreadBinding) -> CodexThreadBinding {
    thread.model = Some(CODEX_MODEL_ID.to_string());
    if matches!(thread.status.as_str(), "running" | "waitingApproval") {
        thread.status = "disconnected".to_string();
    }
    if thread
        .last_assistant_message
        .as_deref()
        .map(|message| message.trim_start().starts_with("[ICE PROJECT SCOPE]"))
        .unwrap_or(false)
    {
        thread.last_assistant_message = None;
    }
    thread
}

fn find_superseded_disconnected_thread_ids(threads: &[CodexThreadBinding]) -> Vec<String> {
    threads
        .iter()
        .filter(|candidate| {
            candidate.status == "disconnected"
                && threads.iter().any(|thread| {
                    thread.project_id == candidate.project_id
                        && thread.thread_id != candidate.thread_id
                        && thread.status != "disconnected"
                })
        })
        .map(|thread| thread.thread_id.clone())
        .collect()
}

fn build_scoped_turn_prompt(project: &ProjectRecord, prompt: &str) -> String {
    format!(
        concat!(
            "[ICE PROJECT SCOPE]\n",
            "Project ID: {project_id}\n",
            "Project Name: {project_name}\n",
            "Project Root: {project_root}\n",
            "Trusted Project: {trusted}\n",
            "\n",
            "You are operating inside one project only.\n",
            "Treat the project root above as your sole workspace.\n",
            "Do not read, edit, create, delete, or run commands outside that root.\n",
            "Do not switch to another project, workspace, or repository.\n",
            "If a request would require leaving this project, refuse and explain that the action is out of scope.\n",
            "Use paths relative to the project root whenever possible.\n",
            "\n",
            "[USER PROMPT]\n",
            "{prompt}"
        ),
        project_id = project.id,
        project_name = project.name,
        project_root = project.root_path,
        trusted = if project.is_trusted { "true" } else { "false" },
        prompt = prompt,
    )
}

fn update_thread_for_approval_request(
    state: &Arc<Mutex<CodexRuntimeState>>,
    thread_id: Option<&str>,
) -> Option<CodexThreadBinding> {
    let mut runtime = state.lock();
    let thread = runtime.threads.get_mut(thread_id?)?;
    thread.status = "waitingApproval".to_string();
    thread.unread = true;
    Some(thread.clone())
}

fn mark_thread_after_approval_response(
    state: &Arc<Mutex<CodexRuntimeState>>,
    thread_id: Option<&str>,
) -> Option<CodexThreadBinding> {
    let mut runtime = state.lock();
    let thread = runtime.threads.get_mut(thread_id?)?;
    if thread.status == "waitingApproval" {
        thread.status = "running".to_string();
    }
    Some(thread.clone())
}

fn mark_thread_after_denial(
    state: &Arc<Mutex<CodexRuntimeState>>,
    thread_id: Option<&str>,
) -> Option<CodexThreadBinding> {
    let mut runtime = state.lock();
    let thread = runtime.threads.get_mut(thread_id?)?;
    thread.status = "idle".to_string();
    Some(thread.clone())
}

#[derive(Debug, Clone)]
struct NotificationOutcome {
    thread: CodexThreadBinding,
    message_update: Option<CodexMessageUpdate>,
}

fn apply_notification_to_threads(
    state: &Arc<Mutex<CodexRuntimeState>>,
    payload: &Value,
) -> Option<NotificationOutcome> {
    let method = payload.get("method").and_then(|value| value.as_str())?;
    let params = payload.get("params").unwrap_or(payload);
    let thread_id = extract_thread_id(params)?;
    let mut runtime = state.lock();
    let thread = runtime.threads.get_mut(&thread_id)?;

    if let Some(title) = extract_title(params) {
        thread.title = Some(title);
    }
    if let Some(model) = extract_model(params) {
        thread.model = Some(normalize_model_id(model));
    }
    if let Some(turn_id) = extract_turn_id(params) {
        thread.last_turn_id = Some(turn_id);
    }
    let assistant_message = if is_assistant_message_notification(method, params) {
        extract_assistant_message_content(method, params)
    } else {
        None
    };
    if let Some(message) = assistant_message.as_deref() {
        let next_summary = if is_delta_notification(method, params) {
            summarize_text(&format!(
                "{}{}",
                thread.last_assistant_message.clone().unwrap_or_default(),
                message
            ))
        } else {
            summarize_text(message)
        };
        thread.last_assistant_message = Some(next_summary);
        thread.unread = true;
    }

    let turn_failed = is_failed_turn_notification(method, params);

    if method == "thread/status/changed" {
        if let Some(status) = extract_thread_runtime_status(params) {
            thread.status = status;
        }
    } else if method.contains("approval") {
        thread.status = "waitingApproval".to_string();
    } else if method == "turn/started" {
        thread.status = "running".to_string();
    } else if turn_failed {
        thread.status = "error".to_string();
    } else if method == "turn/completed" {
        thread.status = "idle".to_string();
    } else if method == "item/completed" {
        if thread.status == "disconnected" {
            thread.status = "idle".to_string();
        }
    } else if method == "error" {
        thread.status = "error".to_string();
    } else if method == "thread/name/updated" && thread.status == "disconnected" {
        thread.status = "idle".to_string();
    }

    let message_update = assistant_message.map(|content| CodexMessageUpdate {
        message_id: assistant_message_id(&thread.thread_id, thread.last_turn_id.as_deref()),
        project_id: thread.project_id.clone(),
        thread_id: thread.thread_id.clone(),
        turn_id: thread.last_turn_id.clone(),
        role: "assistant".to_string(),
        content,
        state: if is_final_message_notification(method, params) {
            "complete".to_string()
        } else {
            "streaming".to_string()
        },
        append: is_delta_notification(method, params),
    });

    Some(NotificationOutcome {
        thread: thread.clone(),
        message_update,
    })
}

fn extract_thread_id(payload: &Value) -> Option<String> {
    payload
        .get("threadId")
        .or_else(|| payload.get("thread_id"))
        .or_else(|| payload.get("thread").and_then(|thread| thread.get("id")))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

fn extract_turn_id(payload: &Value) -> Option<String> {
    payload
        .get("turnId")
        .or_else(|| payload.get("turn_id"))
        .or_else(|| payload.get("turn").and_then(|turn| turn.get("id")))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

fn extract_title(payload: &Value) -> Option<String> {
    payload
        .get("threadName")
        .or_else(|| payload.get("thread_name"))
        .or_else(|| payload.get("title"))
        .or_else(|| payload.get("thread").and_then(|thread| thread.get("title")))
        .or_else(|| {
            payload
                .get("thread")
                .and_then(|thread| thread.get("threadName"))
        })
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

fn extract_model(payload: &Value) -> Option<String> {
    payload
        .get("model")
        .or_else(|| payload.get("thread").and_then(|thread| thread.get("model")))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

fn extract_assistant_message_content(method: &str, payload: &Value) -> Option<String> {
    if let Some(text) = payload
        .get("message")
        .and_then(extract_text_from_value)
        .or_else(|| payload.get("delta").and_then(extract_text_from_value))
        .or_else(|| payload.get("item").and_then(extract_text_from_value))
        .or_else(|| payload.get("content").and_then(extract_text_from_value))
    {
        if method == "item/agentMessage/delta" {
            if !text.is_empty() {
                return Some(text);
            }
            return None;
        }
        let normalized = text.trim_end().to_string();
        if !normalized.trim().is_empty() {
            return Some(normalized);
        }
    }
    None
}

fn is_delta_notification(method: &str, payload: &Value) -> bool {
    method == "item/agentMessage/delta"
        && payload.get("delta").is_some()
        && payload.get("message").is_none()
}

fn is_assistant_message_notification(method: &str, payload: &Value) -> bool {
    if method == "item/agentMessage/delta" {
        return true;
    }
    if method == "item/completed" || method == "item/started" {
        return payload
            .get("item")
            .and_then(|item| item.get("type"))
            .and_then(|value| value.as_str())
            .map(|kind| {
                kind.eq_ignore_ascii_case("assistantMessage")
                    || kind.eq_ignore_ascii_case("agentMessage")
            })
            .unwrap_or(false);
    }
    false
}

fn is_final_message_notification(method: &str, payload: &Value) -> bool {
    method == "item/completed" && is_assistant_message_notification(method, payload)
}

fn is_failed_turn_notification(method: &str, payload: &Value) -> bool {
    (method == "turn/completed" || method == "error")
        && payload
            .get("turn")
            .and_then(|turn| turn.get("status"))
            .and_then(|value| value.as_str())
            .map(|status| status.eq_ignore_ascii_case("failed"))
            .unwrap_or_else(|| payload.get("error").is_some())
}

fn summarize_text(text: &str) -> String {
    text.trim().replace('\n', " ").chars().take(160).collect()
}

fn normalize_model_id(_model: String) -> String {
    CODEX_MODEL_ID.to_string()
}

fn is_terminal_thread_status(status: &str) -> bool {
    matches!(status, "idle" | "error" | "disconnected")
}

fn extract_thread_runtime_status(payload: &Value) -> Option<String> {
    let status = payload.get("status")?;
    if let Some(kind) = status.get("type").and_then(|value| value.as_str()) {
        return match kind {
            "active" => {
                let waiting = status
                    .get("activeFlags")
                    .and_then(|value| value.as_array())
                    .map(|flags| {
                        flags.iter().any(|flag| {
                            flag.as_str()
                                .map(|value| value.to_ascii_lowercase().contains("approval"))
                                .unwrap_or(false)
                        })
                    })
                    .unwrap_or(false);
                Some(
                    if waiting {
                        "waitingApproval"
                    } else {
                        "running"
                    }
                    .to_string(),
                )
            }
            "idle" | "notLoaded" => Some("idle".to_string()),
            "systemError" => Some("error".to_string()),
            _ => None,
        };
    }
    if status.get("systemError").is_some() {
        return Some("error".to_string());
    }
    if status.get("idle").is_some() || status.get("notLoaded").is_some() {
        return Some("idle".to_string());
    }
    None
}

fn assistant_message_id(thread_id: &str, turn_id: Option<&str>) -> String {
    match turn_id {
        Some(turn_id) if !turn_id.is_empty() => format!("{thread_id}:{turn_id}:assistant"),
        _ => format!("{thread_id}:assistant"),
    }
}

fn new_codex_message(
    project_id: String,
    thread_id: String,
    turn_id: Option<String>,
    role: &str,
    content: String,
    state: &str,
) -> CodexMessageRecord {
    let now = chrono::Utc::now().to_rfc3339();
    let message_id = match (role, turn_id.as_deref()) {
        ("user", Some(turn_id)) if !turn_id.is_empty() => format!("{thread_id}:{turn_id}:user"),
        ("assistant", Some(turn_id)) if !turn_id.is_empty() => {
            format!("{thread_id}:{turn_id}:assistant")
        }
        _ => format!("{thread_id}:{}:{}", role, Uuid::new_v4()),
    };
    CodexMessageRecord {
        message_id,
        project_id,
        thread_id,
        turn_id,
        role: role.to_string(),
        content,
        state: state.to_string(),
        created_at: now.clone(),
        updated_at: now,
    }
}

fn extract_text_from_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => items.iter().find_map(extract_text_from_value),
        Value::Object(map) => map
            .get("text")
            .and_then(extract_text_from_value)
            .or_else(|| map.get("message").and_then(extract_text_from_value))
            .or_else(|| map.get("content").and_then(extract_text_from_value))
            .or_else(|| map.get("parts").and_then(extract_text_from_value)),
        _ => None,
    }
}

fn build_pending_approval(
    request_id: u64,
    method: &str,
    payload: &Value,
    threads: &HashMap<String, CodexThreadBinding>,
) -> Option<PendingApprovalRecord> {
    let params = payload.get("params")?;
    let thread_id = params
        .get("threadId")
        .or_else(|| params.get("thread_id"))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned);
    let project_id = thread_id
        .as_ref()
        .and_then(|thread_id| threads.get(thread_id))
        .map(|thread| thread.project_id.clone())
        .unwrap_or_else(|| "global".to_string());
    let description = params
        .get("message")
        .or_else(|| params.get("description"))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned);
    let (category, risk_level, fallback_title) = classify_approval(method, params);
    let (policy_action, policy_reason) =
        apply_approval_policy(method, &category, &risk_level, params);
    Some(PendingApprovalRecord {
        request_id,
        project_id,
        thread_id,
        action_type: method.to_string(),
        category,
        risk_level,
        policy_action,
        policy_reason,
        description: description.unwrap_or(fallback_title),
        context_json: Some(params.clone()),
    })
}

async fn inspect_codex_runtime_info() -> Result<CodexRuntimeInfo> {
    let cli_version = read_codex_version().await.ok();
    let help_text = read_app_server_help().await?;
    let app_server_default_listen = extract_default_listen(&help_text);
    let supports_generate_json_schema = help_text.contains("generate-json-schema");
    let supports_generate_ts = help_text.contains("generate-ts");

    let (schema_sha256, schema_bytes, schema_title, schema_id) = if supports_generate_json_schema {
        match read_app_server_schema().await {
            Ok(schema_text) => {
                let schema_value: Value = serde_json::from_str(&schema_text)?;
                let mut hasher = Sha256::new();
                hasher.update(schema_text.as_bytes());
                let digest = format!("{:x}", hasher.finalize());
                (
                    Some(digest),
                    Some(schema_text.len()),
                    schema_value
                        .get("title")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned),
                    schema_value
                        .get("$id")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned),
                )
            }
            Err(_) => (None, None, None, None),
        }
    } else {
        (None, None, None, None)
    };

    Ok(CodexRuntimeInfo {
        cli_version,
        app_server_default_listen,
        supports_generate_json_schema,
        supports_generate_ts,
        schema_sha256,
        schema_bytes,
        schema_title,
        schema_id,
    })
}

async fn read_codex_version() -> Result<String> {
    let output = Command::new("codex").arg("--version").output().await?;
    if !output.status.success() {
        return Err(anyhow!(
            "{}",
            String::from_utf8_lossy(&output.stderr).trim().to_string()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn read_app_server_help() -> Result<String> {
    let output = Command::new("codex")
        .args(["app-server", "--help"])
        .output()
        .await?;
    if !output.status.success() {
        return Err(anyhow!(
            "{}",
            String::from_utf8_lossy(&output.stderr).trim().to_string()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn read_app_server_schema() -> Result<String> {
    let output = Command::new("codex")
        .args(["app-server", "generate-json-schema"])
        .output()
        .await?;
    if !output.status.success() {
        return Err(anyhow!(
            "{}",
            String::from_utf8_lossy(&output.stderr).trim().to_string()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn extract_default_listen(help_text: &str) -> Option<String> {
    help_text
        .lines()
        .find(|line| line.contains("[default:"))
        .and_then(|line| line.split("[default:").nth(1))
        .map(|value| value.trim().trim_end_matches(']').to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_notification_to_threads, build_pending_approval, build_scoped_turn_prompt,
        extract_default_listen, normalize_thread_after_startup, summarize_text, CodexRuntimeState,
        CodexThreadBinding, CODEX_MODEL_ID,
    };
    use crate::projects::models::ProjectRecord;
    use parking_lot::Mutex;
    use serde_json::json;
    use std::collections::{HashMap, VecDeque};
    use std::sync::Arc;

    #[test]
    fn extracts_default_listen_from_help_text() {
        let help = "Transport endpoint URL\n\n          [default: stdio://]\n";
        assert_eq!(extract_default_listen(help).as_deref(), Some("stdio://"));
    }

    #[test]
    fn pending_approval_includes_policy_metadata() {
        let mut threads = HashMap::new();
        threads.insert(
            "thread-1".to_string(),
            CodexThreadBinding {
                project_id: "project-a".to_string(),
                thread_id: "thread-1".to_string(),
                title: Some("Agent".to_string()),
                model: Some(CODEX_MODEL_ID.to_string()),
                status: "idle".to_string(),
                last_turn_id: None,
                last_assistant_message: None,
                unread: false,
            },
        );
        let payload = json!({
            "params": {
                "threadId": "thread-1",
                "command": "git reset --hard HEAD~1"
            }
        });
        let approval = build_pending_approval(9, "git/exec", &payload, &threads).expect("approval");
        assert_eq!(approval.project_id, "project-a");
        assert_eq!(approval.category, "git");
        assert_eq!(approval.policy_action, "block");
    }

    #[test]
    fn scoped_turn_prompt_includes_project_root_boundary() {
        let prompt = build_scoped_turn_prompt(
            &ProjectRecord {
                id: "project-a".to_string(),
                name: "ice".to_string(),
                root_path: "/Users/deepsaint/Desktop/ice".to_string(),
                color_token: "blue".to_string(),
                icon_hint: None,
                is_trusted: true,
                created_at: "now".to_string(),
                last_opened_at: "now".to_string(),
            },
            "Refactor the git surface",
        );

        assert!(prompt.contains("Project Root: /Users/deepsaint/Desktop/ice"));
        assert!(prompt
            .contains("Do not read, edit, create, delete, or run commands outside that root."));
        assert!(prompt.contains("[USER PROMPT]\nRefactor the git surface"));
    }

    #[test]
    fn v2_agent_message_deltas_persist_full_content_and_summary() {
        let mut threads = HashMap::new();
        threads.insert(
            "thread-1".to_string(),
            CodexThreadBinding {
                project_id: "project-a".to_string(),
                thread_id: "thread-1".to_string(),
                title: Some("Agent".to_string()),
                model: Some(CODEX_MODEL_ID.to_string()),
                status: "idle".to_string(),
                last_turn_id: None,
                last_assistant_message: None,
                unread: false,
            },
        );
        let state = Arc::new(Mutex::new(CodexRuntimeState {
            process: None,
            threads,
            loaded_threads: HashMap::new(),
            pending_server_requests: HashMap::new(),
            recent_stderr: VecDeque::new(),
        }));

        let started = apply_notification_to_threads(
            &state,
            &json!({
                "method": "turn/started",
                "params": {
                    "threadId": "thread-1",
                    "turn": { "id": "turn-1" }
                }
            }),
        )
        .expect("turn started outcome");
        assert_eq!(started.thread.status, "running");
        assert_eq!(started.thread.last_turn_id.as_deref(), Some("turn-1"));

        let delta_text = "This is a full assistant response chunk that should be stored without trimming even when the sidebar preview stays compact.";
        let delta = apply_notification_to_threads(
            &state,
            &json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "itemId": "item-1",
                    "delta": delta_text
                }
            }),
        )
        .expect("delta outcome");
        let message_update = delta.message_update.expect("message update");
        assert_eq!(message_update.content, delta_text);
        assert_eq!(message_update.state, "streaming");
        assert!(message_update.append);
        let expected_summary = summarize_text(delta_text);
        assert_eq!(
            delta.thread.last_assistant_message.as_deref(),
            Some(expected_summary.as_str())
        );
        assert!(delta.thread.unread);

        let completed = apply_notification_to_threads(
            &state,
            &json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "thread-1",
                    "turn": { "id": "turn-1" }
                }
            }),
        )
        .expect("turn completed outcome");
        assert_eq!(completed.thread.status, "idle");
        assert!(completed.message_update.is_none());
    }

    #[test]
    fn agent_message_deltas_preserve_spacing_until_final_message() {
        let mut threads = HashMap::new();
        threads.insert(
            "thread-1".to_string(),
            CodexThreadBinding {
                project_id: "project-a".to_string(),
                thread_id: "thread-1".to_string(),
                title: Some("Agent".to_string()),
                model: Some(CODEX_MODEL_ID.to_string()),
                status: "idle".to_string(),
                last_turn_id: None,
                last_assistant_message: None,
                unread: false,
            },
        );
        let state = Arc::new(Mutex::new(CodexRuntimeState {
            process: None,
            threads,
            loaded_threads: HashMap::new(),
            pending_server_requests: HashMap::new(),
            recent_stderr: VecDeque::new(),
        }));

        let _ = apply_notification_to_threads(
            &state,
            &json!({
                "method": "turn/started",
                "params": {
                    "threadId": "thread-1",
                    "turn": { "id": "turn-1" }
                }
            }),
        )
        .expect("turn started outcome");

        let hello = apply_notification_to_threads(
            &state,
            &json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "delta": "Hello "
                }
            }),
        )
        .expect("hello delta");
        assert_eq!(
            hello.message_update.expect("hello message update").content,
            "Hello "
        );

        let world = apply_notification_to_threads(
            &state,
            &json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "delta": "world"
                }
            }),
        )
        .expect("world delta");
        assert_eq!(
            world.message_update.expect("world message update").content,
            "world"
        );

        let completed = apply_notification_to_threads(
            &state,
            &json!({
                "method": "item/completed",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "item": {
                        "type": "agentMessage",
                        "text": "Hello world"
                    }
                }
            }),
        )
        .expect("completed message");
        let completed_update = completed.message_update.expect("completed update");
        assert_eq!(completed_update.content, "Hello world");
        assert_eq!(completed_update.state, "complete");
    }

    #[test]
    fn user_message_notifications_do_not_overwrite_assistant_content() {
        let mut threads = HashMap::new();
        threads.insert(
            "thread-1".to_string(),
            CodexThreadBinding {
                project_id: "project-a".to_string(),
                thread_id: "thread-1".to_string(),
                title: Some("Agent".to_string()),
                model: Some(CODEX_MODEL_ID.to_string()),
                status: "idle".to_string(),
                last_turn_id: None,
                last_assistant_message: None,
                unread: false,
            },
        );
        let state = Arc::new(Mutex::new(CodexRuntimeState {
            process: None,
            threads,
            loaded_threads: HashMap::new(),
            pending_server_requests: HashMap::new(),
            recent_stderr: VecDeque::new(),
        }));

        let started = apply_notification_to_threads(
            &state,
            &json!({
                "method": "turn/started",
                "params": {
                    "threadId": "thread-1",
                    "turn": { "id": "turn-1" }
                }
            }),
        )
        .expect("turn started outcome");
        assert_eq!(started.thread.status, "running");

        let user_message = apply_notification_to_threads(
            &state,
            &json!({
                "method": "item/completed",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "item": {
                        "type": "userMessage",
                        "content": [
                            { "type": "text", "text": "[ICE PROJECT SCOPE]\n[USER PROMPT]\ntest" }
                        ]
                    }
                }
            }),
        )
        .expect("user message outcome");
        assert!(user_message.message_update.is_none());
        assert_eq!(user_message.thread.last_assistant_message, None);
    }

    #[test]
    fn thread_name_updates_use_v2_thread_name_field() {
        let mut threads = HashMap::new();
        threads.insert(
            "thread-1".to_string(),
            CodexThreadBinding {
                project_id: "project-a".to_string(),
                thread_id: "thread-1".to_string(),
                title: Some("Old".to_string()),
                model: Some(CODEX_MODEL_ID.to_string()),
                status: "idle".to_string(),
                last_turn_id: None,
                last_assistant_message: None,
                unread: false,
            },
        );
        let state = Arc::new(Mutex::new(CodexRuntimeState {
            process: None,
            threads,
            loaded_threads: HashMap::new(),
            pending_server_requests: HashMap::new(),
            recent_stderr: VecDeque::new(),
        }));

        let outcome = apply_notification_to_threads(
            &state,
            &json!({
                "method": "thread/name/updated",
                "params": {
                    "threadId": "thread-1",
                    "threadName": "Renamed Thread"
                }
            }),
        )
        .expect("thread name update");

        assert_eq!(outcome.thread.title.as_deref(), Some("Renamed Thread"));
    }

    #[test]
    fn startup_normalization_forces_gpt54_and_clears_scoped_summary() {
        let normalized = normalize_thread_after_startup(CodexThreadBinding {
            project_id: "project-a".to_string(),
            thread_id: "thread-1".to_string(),
            title: Some("Agent".to_string()),
            model: Some("gpt-5-codex".to_string()),
            status: "running".to_string(),
            last_turn_id: Some("turn-1".to_string()),
            last_assistant_message: Some(
                "[ICE PROJECT SCOPE]\nProject Root: /tmp/demo".to_string(),
            ),
            unread: false,
        });

        assert_eq!(normalized.model.as_deref(), Some(CODEX_MODEL_ID));
        assert_eq!(normalized.status, "disconnected");
        assert_eq!(normalized.last_assistant_message, None);
    }

    #[test]
    fn stale_disconnected_threads_are_pruned_when_a_project_has_a_healthy_thread() {
        let thread_ids = super::find_superseded_disconnected_thread_ids(&[
            CodexThreadBinding {
                project_id: "project-a".to_string(),
                thread_id: "thread-disconnected".to_string(),
                title: Some("Old".to_string()),
                model: Some(CODEX_MODEL_ID.to_string()),
                status: "disconnected".to_string(),
                last_turn_id: None,
                last_assistant_message: None,
                unread: false,
            },
            CodexThreadBinding {
                project_id: "project-a".to_string(),
                thread_id: "thread-idle".to_string(),
                title: Some("New".to_string()),
                model: Some(CODEX_MODEL_ID.to_string()),
                status: "idle".to_string(),
                last_turn_id: None,
                last_assistant_message: None,
                unread: false,
            },
            CodexThreadBinding {
                project_id: "project-b".to_string(),
                thread_id: "thread-only".to_string(),
                title: Some("Only".to_string()),
                model: Some(CODEX_MODEL_ID.to_string()),
                status: "disconnected".to_string(),
                last_turn_id: None,
                last_assistant_message: None,
                unread: false,
            },
        ]);

        assert_eq!(thread_ids, vec!["thread-disconnected".to_string()]);
    }

    #[test]
    fn thread_status_changed_tracks_running_idle_and_error() {
        let mut threads = HashMap::new();
        threads.insert(
            "thread-1".to_string(),
            CodexThreadBinding {
                project_id: "project-a".to_string(),
                thread_id: "thread-1".to_string(),
                title: Some("Agent".to_string()),
                model: Some(CODEX_MODEL_ID.to_string()),
                status: "idle".to_string(),
                last_turn_id: None,
                last_assistant_message: None,
                unread: false,
            },
        );
        let state = Arc::new(Mutex::new(CodexRuntimeState {
            process: None,
            threads,
            loaded_threads: HashMap::new(),
            pending_server_requests: HashMap::new(),
            recent_stderr: VecDeque::new(),
        }));

        let running = apply_notification_to_threads(
            &state,
            &json!({
                "method": "thread/status/changed",
                "params": {
                    "threadId": "thread-1",
                    "status": { "type": "active", "activeFlags": [] }
                }
            }),
        )
        .expect("running status");
        assert_eq!(running.thread.status, "running");

        let idle = apply_notification_to_threads(
            &state,
            &json!({
                "method": "thread/status/changed",
                "params": {
                    "threadId": "thread-1",
                    "status": { "type": "idle" }
                }
            }),
        )
        .expect("idle status");
        assert_eq!(idle.thread.status, "idle");

        let errored = apply_notification_to_threads(
            &state,
            &json!({
                "method": "thread/status/changed",
                "params": {
                    "threadId": "thread-1",
                    "status": { "type": "systemError", "systemError": { "message": "boom" } }
                }
            }),
        )
        .expect("error status");
        assert_eq!(errored.thread.status, "error");
    }
}
