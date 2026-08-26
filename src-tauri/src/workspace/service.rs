use std::sync::Arc;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::persistence::db::PersistenceService;

pub struct WorkspaceService {
    persistence: Arc<PersistenceService>,
}

const SIDEBAR_WIDTH_MIN: u16 = 180;
const SIDEBAR_WIDTH_MAX: u16 = 400;
const BOTTOM_DOCK_HEIGHT_MIN: u16 = 100;
const BOTTOM_DOCK_HEIGHT_MAX: u16 = 600;
const CHAT_PANEL_WIDTH_MIN: u16 = 280;
const CHAT_PANEL_WIDTH_MAX: u16 = 520;
const SPLIT_RATIO_MIN: f64 = 0.15;
const SPLIT_RATIO_MAX: f64 = 0.85;

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
        Ok(normalize_chrome_state(
            self.persistence
                .config_get(&format!("workspace.chrome.{workspace_id}"))
                .await?
                .and_then(|value| serde_json::from_value(value).ok())
                .unwrap_or_else(default_chrome_state),
        ))
    }

    pub async fn set_chrome_state(
        &self,
        workspace_id: &str,
        chrome_state: WorkspaceChromeState,
    ) -> Result<()> {
        let chrome_state = normalize_chrome_state(chrome_state);
        self.persistence
            .config_set(
                format!("workspace.chrome.{workspace_id}"),
                serde_json::to_value(chrome_state)?,
            )
            .await
    }

    pub async fn get_session_state(&self, workspace_id: &str) -> Result<WorkspaceSessionState> {
        Ok(normalize_session_state(
            self.persistence
                .read_workspace_session(workspace_id)
                .await?
                .unwrap_or_else(default_session_state),
        ))
    }

    pub async fn set_session_state(
        &self,
        workspace_id: &str,
        session_state: WorkspaceSessionState,
    ) -> Result<()> {
        let session_state = normalize_session_state(session_state);
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

fn normalize_chrome_state(mut chrome: WorkspaceChromeState) -> WorkspaceChromeState {
    chrome.sidebar_width = chrome
        .sidebar_width
        .clamp(SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX);
    chrome.bottom_dock_height = chrome
        .bottom_dock_height
        .clamp(BOTTOM_DOCK_HEIGHT_MIN, BOTTOM_DOCK_HEIGHT_MAX);
    chrome.chat_panel_width = chrome
        .chat_panel_width
        .clamp(CHAT_PANEL_WIDTH_MIN, CHAT_PANEL_WIDTH_MAX);
    chrome
}

fn default_session_state() -> WorkspaceSessionState {
    WorkspaceSessionState {
        active_pane_id: "pane-1".to_string(),
        tabs: Vec::new(),
        root: WorkspacePaneNode::Leaf {
            id: "pane-1".to_string(),
            tabs: Vec::new(),
            active_tab_id: None,
        },
    }
}

fn normalize_session_state(mut session: WorkspaceSessionState) -> WorkspaceSessionState {
    normalize_node_geometry(&mut session.root);
    session
}

fn normalize_node_geometry(node: &mut WorkspacePaneNode) {
    if let WorkspacePaneNode::Split(split) = node {
        if split.direction != "horizontal" && split.direction != "vertical" {
            split.direction = "horizontal".to_string();
        }
        split.ratio = if split.ratio.is_finite() {
            split.ratio.clamp(SPLIT_RATIO_MIN, SPLIT_RATIO_MAX)
        } else {
            0.5
        };
        for child in &mut split.children {
            normalize_node_geometry(child);
        }
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

    let referenced_tab_set: HashSet<_> = referenced_tabs.iter().cloned().collect();
    if referenced_tab_set.len() != referenced_tabs.len() {
        return Err(anyhow!(
            "workspace session references the same tab in multiple panes"
        ));
    }

    for tab_id in &referenced_tabs {
        if !tab_id_set.contains(tab_id) {
            return Err(anyhow!(
                "workspace session references unknown tab id {}",
                tab_id
            ));
        }
    }
    for tab_id in &tab_ids {
        if !referenced_tab_set.contains(tab_id) {
            return Err(anyhow!(
                "workspace session contains orphan tab id {}",
                tab_id
            ));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(id: &str) -> WorkspaceTabRecord {
        WorkspaceTabRecord {
            id: id.to_string(),
            project_id: "project-1".to_string(),
            kind: "editor".to_string(),
            title: id.to_string(),
            icon: None,
            dirty: false,
            pinned: false,
            meta: None,
        }
    }

    #[test]
    fn default_session_has_no_synthetic_project_tabs() {
        let session = default_session_state();

        assert_eq!(session.active_pane_id, "pane-1");
        assert!(session.tabs.is_empty());
        assert_eq!(
            session.root,
            WorkspacePaneNode::Leaf {
                id: "pane-1".to_string(),
                tabs: Vec::new(),
                active_tab_id: None,
            },
        );
        validate_session_state(&session).expect("default session should be valid");
    }

    #[test]
    fn normalizes_chrome_dimensions_to_renderable_bounds() {
        let chrome = normalize_chrome_state(WorkspaceChromeState {
            sidebar_open: false,
            sidebar_width: 1,
            bottom_dock_open: true,
            bottom_dock_height: 65_535,
            chat_panel_open: false,
            chat_panel_width: 100,
        });

        assert!(!chrome.sidebar_open);
        assert_eq!(chrome.sidebar_width, SIDEBAR_WIDTH_MIN);
        assert!(chrome.bottom_dock_open);
        assert_eq!(chrome.bottom_dock_height, BOTTOM_DOCK_HEIGHT_MAX);
        assert!(!chrome.chat_panel_open);
        assert_eq!(chrome.chat_panel_width, CHAT_PANEL_WIDTH_MIN);
    }

    #[test]
    fn normalizes_split_geometry_to_renderable_bounds() {
        let session = normalize_session_state(WorkspaceSessionState {
            active_pane_id: "pane-1".to_string(),
            tabs: Vec::new(),
            root: WorkspacePaneNode::Split(WorkspaceSplitNode {
                id: "split-1".to_string(),
                direction: "diagonal".to_string(),
                ratio: 1.0,
                children: vec![
                    WorkspacePaneNode::Leaf {
                        id: "pane-1".to_string(),
                        tabs: Vec::new(),
                        active_tab_id: None,
                    },
                    WorkspacePaneNode::Split(WorkspaceSplitNode {
                        id: "split-2".to_string(),
                        direction: "vertical".to_string(),
                        ratio: f64::NAN,
                        children: vec![
                            WorkspacePaneNode::Leaf {
                                id: "pane-2".to_string(),
                                tabs: Vec::new(),
                                active_tab_id: None,
                            },
                            WorkspacePaneNode::Leaf {
                                id: "pane-3".to_string(),
                                tabs: Vec::new(),
                                active_tab_id: None,
                            },
                        ],
                    }),
                ],
            }),
        });

        match session.root {
            WorkspacePaneNode::Split(root) => {
                assert_eq!(root.direction, "horizontal");
                assert_eq!(root.ratio, SPLIT_RATIO_MAX);
                match &root.children[1] {
                    WorkspacePaneNode::Split(child) => {
                        assert_eq!(child.direction, "vertical");
                        assert_eq!(child.ratio, 0.5);
                    }
                    WorkspacePaneNode::Leaf { .. } => panic!("expected nested split"),
                }
            }
            WorkspacePaneNode::Leaf { .. } => panic!("expected split root"),
        }
    }

    #[test]
    fn validates_tabs_are_referenced_once_by_panes() {
        let session = WorkspaceSessionState {
            active_pane_id: "pane-1".to_string(),
            tabs: vec![tab("tab-1"), tab("tab-2")],
            root: WorkspacePaneNode::Split(WorkspaceSplitNode {
                id: "split-1".to_string(),
                direction: "horizontal".to_string(),
                ratio: 0.5,
                children: vec![
                    WorkspacePaneNode::Leaf {
                        id: "pane-1".to_string(),
                        tabs: vec!["tab-1".to_string()],
                        active_tab_id: Some("tab-1".to_string()),
                    },
                    WorkspacePaneNode::Leaf {
                        id: "pane-2".to_string(),
                        tabs: vec!["tab-2".to_string()],
                        active_tab_id: Some("tab-2".to_string()),
                    },
                ],
            }),
        };

        validate_session_state(&session).expect("valid session should pass");
    }

    #[test]
    fn rejects_tabs_referenced_by_multiple_panes() {
        let session = WorkspaceSessionState {
            active_pane_id: "pane-1".to_string(),
            tabs: vec![tab("tab-1")],
            root: WorkspacePaneNode::Split(WorkspaceSplitNode {
                id: "split-1".to_string(),
                direction: "horizontal".to_string(),
                ratio: 0.5,
                children: vec![
                    WorkspacePaneNode::Leaf {
                        id: "pane-1".to_string(),
                        tabs: vec!["tab-1".to_string()],
                        active_tab_id: Some("tab-1".to_string()),
                    },
                    WorkspacePaneNode::Leaf {
                        id: "pane-2".to_string(),
                        tabs: vec!["tab-1".to_string()],
                        active_tab_id: Some("tab-1".to_string()),
                    },
                ],
            }),
        };

        let error =
            validate_session_state(&session).expect_err("duplicate tab reference should fail");
        assert!(error
            .to_string()
            .contains("references the same tab in multiple panes"));
    }

    #[test]
    fn rejects_orphan_tab_records() {
        let session = WorkspaceSessionState {
            active_pane_id: "pane-1".to_string(),
            tabs: vec![tab("tab-1"), tab("tab-orphan")],
            root: WorkspacePaneNode::Leaf {
                id: "pane-1".to_string(),
                tabs: vec!["tab-1".to_string()],
                active_tab_id: Some("tab-1".to_string()),
            },
        };

        let error = validate_session_state(&session).expect_err("orphan tab record should fail");
        assert!(error
            .to_string()
            .contains("workspace session contains orphan tab id tab-orphan"));
    }
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
