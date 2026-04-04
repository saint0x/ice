use std::sync::Arc;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::persistence::db::PersistenceService;

pub struct WorkspaceService {
    persistence: Arc<PersistenceService>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChromeState {
    pub sidebar_open: bool,
    pub sidebar_width: u16,
    pub bottom_dock_open: bool,
    pub bottom_dock_height: u16,
    pub chat_panel_open: bool,
    pub chat_panel_width: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTabRecord {
    pub id: String,
    pub project_id: String,
    pub kind: String,
    pub title: String,
    pub icon: Option<String>,
    pub dirty: bool,
    pub pinned: bool,
    pub meta: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WorkspacePaneNode {
    Leaf {
        id: String,
        tabs: Vec<String>,
        active_tab_id: Option<String>,
    },
    Split(WorkspaceSplitNode),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSplitNode {
    pub id: String,
    pub direction: String,
    pub children: Vec<WorkspacePaneNode>,
    pub ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionState {
    pub active_pane_id: String,
    pub tabs: Vec<WorkspaceTabRecord>,
    pub root: WorkspacePaneNode,
}

impl WorkspaceService {
    pub fn new(persistence: Arc<PersistenceService>) -> Self {
        Self { persistence }
    }

    pub async fn get_layout(&self, workspace_id: &str) -> Result<Option<Value>> {
        self.persistence.read_workspace_layout(workspace_id).await
    }

    pub async fn set_layout(&self, workspace_id: &str, layout_json: Value) -> Result<()> {
        self.persistence
            .upsert_workspace_layout(workspace_id.to_owned(), layout_json)
            .await
    }

    pub async fn get_chrome_state(&self, workspace_id: &str) -> Result<WorkspaceChromeState> {
        Ok(self
            .persistence
            .config_get(&format!("workspace.chrome.{workspace_id}"))
            .await?
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_else(default_chrome_state))
    }

    pub async fn set_chrome_state(
        &self,
        workspace_id: &str,
        chrome_state: WorkspaceChromeState,
    ) -> Result<()> {
        self.persistence
            .config_set(
                format!("workspace.chrome.{workspace_id}"),
                serde_json::to_value(chrome_state)?,
            )
            .await
    }

    pub async fn get_session_state(&self, workspace_id: &str) -> Result<WorkspaceSessionState> {
        Ok(self
            .persistence
            .read_workspace_session(workspace_id)
            .await?
            .unwrap_or_else(default_session_state))
    }

    pub async fn set_session_state(
        &self,
        workspace_id: &str,
        session_state: WorkspaceSessionState,
    ) -> Result<()> {
        validate_session_state(&session_state)?;
        self.persistence
            .upsert_workspace_session(workspace_id.to_owned(), &session_state)
            .await
    }
}

fn default_chrome_state() -> WorkspaceChromeState {
    WorkspaceChromeState {
        sidebar_open: true,
        sidebar_width: 240,
        bottom_dock_open: true,
        bottom_dock_height: 240,
        chat_panel_open: false,
        chat_panel_width: 360,
    }
}

fn default_session_state() -> WorkspaceSessionState {
    WorkspaceSessionState {
        active_pane_id: "pane-1".to_string(),
        tabs: vec![WorkspaceTabRecord {
            id: "tab-1".to_string(),
            project_id: "system".to_string(),
            kind: "settings".to_string(),
            title: "Welcome".to_string(),
            icon: Some("sparkles".to_string()),
            dirty: false,
            pinned: false,
            meta: Some(serde_json::json!({"view":"welcome"})),
        }],
        root: WorkspacePaneNode::Leaf {
            id: "pane-1".to_string(),
            tabs: vec!["tab-1".to_string()],
            active_tab_id: Some("tab-1".to_string()),
        },
    }
}

fn validate_session_state(session_state: &WorkspaceSessionState) -> Result<()> {
    use anyhow::anyhow;
    use std::collections::HashSet;

    let mut pane_ids = Vec::new();
    let mut referenced_tabs = Vec::new();
    collect_node_state(&session_state.root, &mut pane_ids, &mut referenced_tabs)?;

    let pane_id_set: HashSet<_> = pane_ids.iter().cloned().collect();
    if pane_id_set.len() != pane_ids.len() {
        return Err(anyhow!("workspace session contains duplicate pane ids"));
    }
    if !pane_id_set.contains(&session_state.active_pane_id) {
        return Err(anyhow!("workspace session active pane does not exist"));
    }

    let tab_ids: Vec<_> = session_state
        .tabs
        .iter()
        .map(|tab| tab.id.clone())
        .collect();
    let tab_id_set: HashSet<_> = tab_ids.iter().cloned().collect();
    if tab_id_set.len() != tab_ids.len() {
        return Err(anyhow!("workspace session contains duplicate tab ids"));
    }

    for tab_id in referenced_tabs {
        if !tab_id_set.contains(&tab_id) {
            return Err(anyhow!(
                "workspace session references unknown tab id {}",
                tab_id
            ));
        }
    }

    Ok(())
}

fn collect_node_state(
    node: &WorkspacePaneNode,
    pane_ids: &mut Vec<String>,
    referenced_tabs: &mut Vec<String>,
) -> Result<()> {
    use anyhow::anyhow;

    match node {
        WorkspacePaneNode::Leaf {
            id,
            tabs,
            active_tab_id,
        } => {
            pane_ids.push(id.clone());
            referenced_tabs.extend(tabs.iter().cloned());
            if let Some(active_tab_id) = active_tab_id {
                if !tabs.iter().any(|tab_id| tab_id == active_tab_id) {
                    return Err(anyhow!(
                        "workspace pane {} has active tab {} that is not present",
                        id,
                        active_tab_id
                    ));
                }
            }
        }
        WorkspacePaneNode::Split(split) => {
            if split.children.len() < 2 {
                return Err(anyhow!(
                    "workspace split {} must have at least two children",
                    split.id
                ));
            }
            if !(0.0..=1.0).contains(&split.ratio) {
                return Err(anyhow!(
                    "workspace split {} ratio must be between 0 and 1",
                    split.id
                ));
            }
            for child in &split.children {
                collect_node_state(child, pane_ids, referenced_tabs)?;
            }
        }
    }

    Ok(())
}
