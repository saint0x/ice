use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::app::events::CODEX_EVENT;
use crate::app::paths::IcePaths;
use crate::persistence::db::PersistenceService;
use crate::security::approvals::{PendingApprovalRecord, SecurityService};

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModel {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
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
}

impl CodexService {
    pub fn new(
        app: AppHandle,
        persistence: Arc<PersistenceService>,
        paths: IcePaths,
        security: Arc<SecurityService>,
    ) -> Self {
        let persisted_threads = persistence.load_codex_threads_sync().unwrap_or_default();
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
        let state = self.state.lock();
        CodexStatus {
            running: state.process.is_some(),
            available,
            thread_count: state.threads.len(),
        }
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

    pub async fn respond_to_server_request(&self, request_id: u64, result: Value) -> Result<()> {
        let process = self.ensure_process().await?;
        self.state
            .lock()
            .pending_server_requests
            .remove(&request_id);
        self.security.resolve_approval(request_id).await?;
        let payload = json!({ "id": request_id, "result": result });
        let mut stdin = process.stdin.lock().await;
        stdin.write_all(payload.to_string().as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
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
        if let Some(process) = self.state.lock().process.as_ref() {
            return Ok(process.clone());
        }

        let mut child = Command::new("codex")
            .arg("app-server")
            .env("CODEX_HOME", self.paths.concern_dir("codex"))
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
                        let _ = app.emit(
                            CODEX_EVENT,
                            json!({ "type": "notification", "payload": value }),
                        );
                    }
                }
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
        .unwrap_or(method)
        .to_string();
    Some(PendingApprovalRecord {
        request_id,
        project_id,
        thread_id,
        action_type: method.to_string(),
        description,
        context_json: Some(params.clone()),
    })
}
