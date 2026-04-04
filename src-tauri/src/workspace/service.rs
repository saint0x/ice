use std::sync::Arc;

use anyhow::Result;
use serde_json::Value;

use crate::persistence::db::PersistenceService;

pub struct WorkspaceService {
    persistence: Arc<PersistenceService>,
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
}
