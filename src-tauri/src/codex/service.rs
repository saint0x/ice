use std::collections::HashMap;
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
use crate::security::approvals::{
    apply_approval_policy, classify_approval, PendingApprovalRecord, SecurityService,
};

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
    pending_server_requests: HashMap<u64, String>,
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

impl CodexService {
    pub fn new(
        app: AppHandle,
        persistence: Arc<PersistenceService>,
        paths: IcePaths,
        security: Arc<SecurityService>,
    ) -> Self {
        let persisted_threads = persistence
            .load_codex_threads_sync()
            .unwrap_or_default()
            .into_iter()
            .map(normalize_thread_after_startup)
            .collect::<Vec<_>>();
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
                pending_server_requests: HashMap::new(),
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
                Some(CodexModel {
                    id: item.get("id")?.as_str()?.to_string(),
                    display_name: item
                        .get("displayName")
                        .or_else(|| item.get("display_name"))
                        .and_then(|value| value.as_str())
                        .unwrap_or_else(|| {
                            item.get("id")
                                .and_then(|value| value.as_str())
                                .unwrap_or("model")
                        })
                        .to_string(),
                    is_default: item
                        .get("isDefault")
                        .or_else(|| item.get("is_default"))
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false),
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
        model: Option<String>,
    ) -> Result<CodexThreadBinding> {
        let result = self
            .request(
                "thread/start",
                json!({
                  "title": title,
                  "model": model
                }),
            )
            .await?;
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
        self.state.lock().threads.insert(thread_id, binding.clone());
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
        model: Option<String>,
    ) -> Result<Value> {
        let result = self
            .request(
                "turn/start",
                json!({
                  "threadId": thread_id,
                  "model": model,
                  "input": {
                    "type": "text",
                    "text": prompt
                  }
                }),
            )
            .await?;
        let updated_binding = {
            let mut state = self.state.lock();
            if let Some(binding) = state.threads.get_mut(&thread_id) {
                binding.project_id = project_id;
                binding.status = "running".to_string();
                binding.unread = false;
                binding.last_turn_id = result
                    .get("turn")
                    .and_then(|turn| turn.get("id"))
                    .and_then(|value| value.as_str())
                    .map(ToOwned::to_owned);
                Some(binding.clone())
            } else {
                None
            }
        };
        if let Some(binding) = updated_binding {
            self.persistence.upsert_codex_thread(binding).await?;
        }
        Ok(result)
    }

    pub async fn list_threads(&self, project_id: Option<&str>) -> Vec<CodexThreadBinding> {
        self.state
            .lock()
            .threads
            .values()
            .filter(|thread| {
                project_id
                    .map(|candidate| thread.project_id == candidate)
                    .unwrap_or(true)
            })
            .cloned()
            .collect()
    }

    pub async fn sidebar_threads(&self, project_id: &str) -> Vec<ProjectCodexSidebarItem> {
        let mut items = self
            .state
            .lock()
            .threads
            .values()
            .filter(|thread| thread.project_id == project_id)
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
        items.sort_by(|left, right| {
            right
                .unread
                .cmp(&left.unread)
                .then_with(|| left.title.cmp(&right.title))
        });
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
        }
        self.persistence
            .delete_codex_threads_for_project(project_id.to_string())
            .await
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
            let disconnected_threads = {
                let mut runtime = self.state.lock();
                runtime.process = None;
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
            };
            for thread in disconnected_threads {
                self.persistence.upsert_codex_thread(thread).await?;
            }
            let _ = self
                .app
                .emit(CODEX_EVENT, json!({ "type": "serverDisconnected" }));
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
        let _ = rx.await.context("initialize response channel dropped")??;
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

        rx.await.context("codex response channel dropped")?
    }

    async fn write_to_process(&self, process: &CodexProcess, payload: Value) -> Result<()> {
        let mut stdin = process.stdin.lock().await;
        stdin.write_all(payload.to_string().as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
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
                                Err(anyhow!(error.to_string()))
                            } else {
                                Ok(value.get("result").cloned().unwrap_or(Value::Null))
                            };
                            let _ = sender.send(result);
                        }
                    } else {
                        if let Some(thread) = apply_notification_to_threads(&state, &value) {
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
                }
            }
            let disconnected_threads = {
                let mut runtime = state.lock();
                runtime.process = None;
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
            };
            for thread in disconnected_threads {
                let _ = persistence.upsert_codex_thread(thread).await;
            }
            let _ = app.emit(CODEX_EVENT, json!({ "type": "serverDisconnected" }));
        });

        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(CODEX_EVENT, json!({ "type": "stderr", "line": line }));
            }
        });
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

fn normalize_thread_after_startup(mut thread: CodexThreadBinding) -> CodexThreadBinding {
    if matches!(thread.status.as_str(), "running" | "waitingApproval") {
        thread.status = "disconnected".to_string();
    }
    thread
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

fn apply_notification_to_threads(
    state: &Arc<Mutex<CodexRuntimeState>>,
    payload: &Value,
) -> Option<CodexThreadBinding> {
    let method = payload.get("method").and_then(|value| value.as_str())?;
    let params = payload.get("params").unwrap_or(payload);
    let thread_id = extract_thread_id(params)?;
    let mut runtime = state.lock();
    let thread = runtime.threads.get_mut(&thread_id)?;

    if let Some(title) = extract_title(params) {
        thread.title = Some(title);
    }
    if let Some(model) = extract_model(params) {
        thread.model = Some(model);
    }
    if let Some(turn_id) = extract_turn_id(params) {
        thread.last_turn_id = Some(turn_id);
    }
    if let Some(message) = extract_assistant_message(params) {
        thread.last_assistant_message = Some(message);
        thread.unread = true;
    }

    if method.contains("approval") {
        thread.status = "waitingApproval".to_string();
    } else if method.contains("turn/start")
        || method.contains("turn.started")
        || method.contains("turn/update")
        || method.contains("turn.delta")
    {
        thread.status = "running".to_string();
    } else if method.contains("turn/completed")
        || method.contains("turn.completed")
        || method.contains("turn/finished")
    {
        thread.status = "idle".to_string();
    } else if method.contains("turn/failed") || method.contains("turn.error") {
        thread.status = "error".to_string();
    } else if method.contains("thread/updated") && thread.status == "disconnected" {
        thread.status = "idle".to_string();
    }

    Some(thread.clone())
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
        .get("title")
        .or_else(|| payload.get("thread").and_then(|thread| thread.get("title")))
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

fn extract_assistant_message(payload: &Value) -> Option<String> {
    if let Some(text) = payload
        .get("message")
        .and_then(extract_text_from_value)
        .or_else(|| payload.get("delta").and_then(extract_text_from_value))
        .or_else(|| payload.get("item").and_then(extract_text_from_value))
        .or_else(|| payload.get("content").and_then(extract_text_from_value))
    {
        let summary = text.trim().replace('\n', " ");
        if !summary.is_empty() {
            return Some(summary.chars().take(160).collect());
        }
    }
    None
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
    use super::{build_pending_approval, extract_default_listen, CodexThreadBinding};
    use serde_json::json;
    use std::collections::HashMap;

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
                model: Some("gpt-5-codex".to_string()),
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
}
