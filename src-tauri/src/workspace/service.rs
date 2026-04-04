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
