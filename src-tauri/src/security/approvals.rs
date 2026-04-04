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
    pub category: String,
    pub risk_level: String,
    pub description: String,
    pub context_json: Option<Value>,
}

pub struct SecurityService {
    persistence: Arc<PersistenceService>,
    approvals: RwLock<HashMap<u64, PendingApprovalRecord>>,
}

pub fn classify_approval(method: &str, payload: &Value) -> (String, String, String) {
    let method_lower = method.to_ascii_lowercase();
    let path_text = payload
        .get("path")
        .or_else(|| payload.get("target"))
        .or_else(|| payload.get("command"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if method_lower.contains("exec")
        || method_lower.contains("shell")
        || method_lower.contains("command")
    {
        let risk = if path_text.contains("rm ")
            || path_text.contains("sudo")
            || path_text.contains("chmod")
            || path_text.contains("chown")
        {
            "high"
        } else {
            "medium"
        };
        return (
            "command".to_string(),
            risk.to_string(),
            "Run Command".to_string(),
        );
    }

    if method_lower.contains("delete") || method_lower.contains("remove") {
        return (
            "filesystem".to_string(),
            "high".to_string(),
            "Delete Files".to_string(),
        );
    }

    if method_lower.contains("write")
        || method_lower.contains("edit")
        || method_lower.contains("patch")
        || method_lower.contains("create")
    {
        return (
            "filesystem".to_string(),
            "medium".to_string(),
            "Edit Files".to_string(),
        );
    }

    if method_lower.contains("browser")
        || method_lower.contains("open_url")
        || method_lower.contains("navigate")
    {
        return (
            "browser".to_string(),
            "low".to_string(),
            "Open Browser".to_string(),
        );
    }

    if method_lower.contains("git") {
        let risk = if method_lower.contains("push")
            || method_lower.contains("reset")
            || method_lower.contains("checkout")
        {
            "high"
        } else {
            "medium"
        };
        return (
            "git".to_string(),
            risk.to_string(),
            "Git Action".to_string(),
        );
    }

    (
        "unknown".to_string(),
        "medium".to_string(),
        "Approval Required".to_string(),
    )
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
