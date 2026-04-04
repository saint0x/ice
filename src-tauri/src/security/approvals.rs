use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use parking_lot::RwLock;
use serde::Serialize;
use serde_json::Value;

use crate::persistence::db::PersistenceService;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingApprovalRecord {
    pub request_id: u64,
    pub project_id: String,
    pub thread_id: Option<String>,
    pub action_type: String,
    pub description: String,
    pub context_json: Option<Value>,
}

pub struct SecurityService {
    persistence: Arc<PersistenceService>,
    approvals: RwLock<HashMap<u64, PendingApprovalRecord>>,
}

impl SecurityService {
    pub fn new(persistence: Arc<PersistenceService>) -> Self {
        let approvals = persistence
            .load_pending_approvals_sync()
            .unwrap_or_default()
            .into_iter()
            .map(|approval| (approval.request_id, approval))
            .collect();
        Self {
            persistence,
            approvals: RwLock::new(approvals),
        }
    }

    pub async fn list_approvals(&self, project_id: Option<&str>) -> Vec<PendingApprovalRecord> {
        self.approvals
            .read()
            .values()
            .filter(|approval| {
                project_id
                    .map(|candidate| approval.project_id == candidate)
                    .unwrap_or(true)
            })
            .cloned()
            .collect()
    }

    pub async fn upsert_approval(&self, approval: PendingApprovalRecord) -> Result<()> {
        self.approvals
            .write()
            .insert(approval.request_id, approval.clone());
        self.persistence.upsert_pending_approval(approval).await
    }

    pub async fn resolve_approval(&self, request_id: u64) -> Result<Option<PendingApprovalRecord>> {
        let removed = self.approvals.write().remove(&request_id);
        self.persistence.delete_pending_approval(request_id).await?;
        Ok(removed)
    }

    pub async fn remove_project_approvals(&self, project_id: &str) -> Result<()> {
        self.approvals
            .write()
            .retain(|_, approval| approval.project_id != project_id);
        self.persistence
            .delete_pending_approvals_for_project(project_id.to_string())
            .await
    }
}
