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
