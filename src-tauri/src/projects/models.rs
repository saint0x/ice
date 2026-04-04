use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub color_token: String,
    pub icon_hint: Option<String>,
    pub is_trusted: bool,
    pub created_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    #[serde(flatten)]
    pub project: ProjectRecord,
    pub git_branch: Option<String>,
    pub terminal_count: usize,
    pub browser_tab_count: usize,
    pub codex_thread_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BrowserRestorePolicy {
    None,
    Pinned,
    All,
}

impl Default for BrowserRestorePolicy {
    fn default() -> Self {
        Self::Pinned
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBrowserSidebarItem {
    pub tab_id: String,
    pub title: String,
    pub url: String,
    pub is_pinned: bool,
    pub is_loading: bool,
    pub is_secure: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCodexSidebarItem {
    pub thread_id: String,
    pub title: String,
    pub status: String,
    pub unread: bool,
    pub last_assistant_message: Option<String>,
}
