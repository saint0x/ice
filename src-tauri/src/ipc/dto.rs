use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthDto {
    pub ok: bool,
    pub app_version: String,
    pub codex_available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBootstrapDto {
    pub storage_root: String,
    pub db_path: String,
    pub projects: Vec<crate::projects::models::ProjectSummary>,
    pub workspace_layout: Option<serde_json::Value>,
    pub workspace_chrome: crate::workspace::service::WorkspaceChromeState,
    pub workspace_session: crate::workspace::service::WorkspaceSessionState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotDto {
    pub project: crate::projects::models::ProjectSummary,
    pub tree: Vec<crate::fs::service::FsEntry>,
    pub git: crate::git::service::GitStatusSummary,
    pub browser_tabs: Vec<crate::browser::service::BrowserTabRecord>,
    pub terminal_sessions: Vec<crate::terminal::service::TerminalSessionRecord>,
    pub codex_threads: Vec<crate::codex::service::CodexThreadBinding>,
    pub approvals: Vec<crate::security::approvals::PendingApprovalRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfigSetInput {
    pub key: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddProjectInput {
    pub root_path: String,
    pub trusted: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderProjectsInput {
    pub project_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTreeInput {
    pub project_id: String,
    pub path: Option<String>,
    pub depth: Option<usize>,
    pub include_hidden: Option<bool>,
    pub respect_gitignore: Option<bool>,
    pub max_entries: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotInput {
    pub project_id: String,
    pub tree_depth: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileInput {
    pub project_id: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchInput {
    pub project_id: String,
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileInput {
    pub project_id: String,
    pub path: String,
    pub content: String,
    pub expected_version_token: Option<String>,
    pub encoding: Option<String>,
    pub has_bom: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDirInput {
    pub project_id: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteEntryInput {
    pub project_id: String,
    pub path: String,
    pub recursive: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameEntryInput {
    pub project_id: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorkspaceLayoutInput {
    pub workspace_id: String,
    pub layout_json: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorkspaceChromeInput {
    pub workspace_id: String,
    pub chrome_state: crate::workspace::service::WorkspaceChromeState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorkspaceSessionInput {
    pub workspace_id: String,
    pub session_state: crate::workspace::service::WorkspaceSessionState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabCreateInput {
    pub project_id: String,
    pub url: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabNavigateInput {
    pub tab_id: String,
    pub url: String,
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateInput {
    pub project_id: String,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub title: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub startup_command: Option<String>,
    pub env_overrides: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteInput {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeInput {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRenameInput {
    pub session_id: String,
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScrollbackInput {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPathsInput {
    pub project_id: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRestoreInput {
    pub project_id: String,
    pub paths: Vec<String>,
    pub staged: Option<bool>,
    pub worktree: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchCheckoutInput {
    pub project_id: String,
    pub branch_name: String,
    pub create: Option<bool>,
    pub start_point: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFetchInput {
    pub project_id: String,
    pub remote: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullInput {
    pub project_id: String,
    pub remote: Option<String>,
    pub branch: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushInput {
    pub project_id: String,
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub set_upstream: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInput {
    pub project_id: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitReadinessInput {
    pub project_id: String,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffInput {
    pub project_id: String,
    pub path: String,
    pub staged: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffTreeInput {
    pub project_id: String,
    pub staged: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexLoginStartInput {
    pub mode: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexThreadCreateInput {
    pub project_id: String,
    pub title: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTurnStartInput {
    pub project_id: String,
    pub thread_id: String,
    pub prompt: String,
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexServerRequestRespondInput {
    pub request_id: u64,
    pub result: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexServerRequestDenyInput {
    pub request_id: u64,
    pub message: Option<String>,
}
