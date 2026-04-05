use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use parking_lot::RwLock;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::app::events::SECURITY_EVENT;
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
    pub policy_action: String,
    pub policy_reason: Option<String>,
    pub description: String,
    pub context_json: Option<Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalAuditRecord {
    pub audit_id: i64,
    pub request_id: u64,
    pub project_id: String,
    pub thread_id: Option<String>,
    pub action_type: String,
    pub category: String,
    pub risk_level: String,
    pub policy_action: String,
    pub policy_reason: Option<String>,
    pub decision: String,
    pub description: String,
    pub context_json: Option<Value>,
    pub created_at: String,
}

pub struct SecurityService {
    app: AppHandle,
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

    (
        "unknown".to_string(),
        "medium".to_string(),
        "Approval Required".to_string(),
    )
}

pub fn apply_approval_policy(
    method: &str,
    category: &str,
    risk_level: &str,
    payload: &Value,
) -> (String, Option<String>) {
    let method_lower = method.to_ascii_lowercase();
    let command_text = payload
        .get("command")
        .or_else(|| payload.get("cmd"))
        .or_else(|| payload.get("target"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let is_destructive_shell = command_text.contains("rm -rf")
        || command_text.contains("mkfs")
        || command_text.contains("dd if=")
        || command_text.contains("shutdown")
        || command_text.contains("reboot")
        || command_text.contains("sudo rm")
        || command_text.contains("git reset --hard")
        || command_text.contains("git clean -fd")
        || command_text.contains("git clean -fdx");

    if category == "command" && is_destructive_shell {
        return (
            "block".to_string(),
            Some("Blocked destructive shell command".to_string()),
        );
    }

    if category == "git"
        && (method_lower.contains("reset") || command_text.contains("git reset --hard"))
    {
        return (
            "block".to_string(),
            Some("Blocked destructive git reset".to_string()),
        );
    }

    if category == "filesystem" && risk_level == "high" {
        return (
            "prompt".to_string(),
            Some("High-risk filesystem mutation requires explicit approval".to_string()),
        );
    }

    if risk_level == "high" {
        return (
            "prompt".to_string(),
            Some("High-risk action requires explicit approval".to_string()),
        );
    }

    ("prompt".to_string(), None)
}

pub fn enforce_project_scope_policy(
    approval: &PendingApprovalRecord,
    project_root: &Path,
) -> Option<String> {
    let context = approval.context_json.as_ref()?;

    if approval.project_id == "global"
        && matches!(approval.category.as_str(), "command" | "git" | "filesystem")
    {
        return Some("Blocked unscoped agent action".to_string());
    }

    if let Some(cwd) = context.get("cwd").and_then(|value| value.as_str()) {
        if !path_is_within_root(project_root, cwd) {
            return Some(format!("Blocked action outside project root: {cwd}"));
        }
    }

    for candidate in extract_path_candidates(context) {
        if !path_is_within_root(project_root, &candidate) {
            return Some(format!("Blocked action outside project root: {candidate}"));
        }
    }

    for candidate in extract_command_path_candidates(context) {
        if !path_is_within_root(project_root, &candidate) {
            return Some(format!(
                "Blocked command path outside project root: {candidate}"
            ));
        }
    }

    None
}

fn extract_path_candidates(context: &Value) -> Vec<String> {
    let mut out = Vec::new();

    for key in ["path", "target"] {
        if let Some(value) = context.get(key).and_then(|value| value.as_str()) {
            out.push(value.to_string());
        }
    }

    if let Some(values) = context.get("paths").and_then(|value| value.as_array()) {
        for value in values {
            if let Some(path) = value.as_str() {
                out.push(path.to_string());
            }
        }
    }

    out
}

fn extract_command_path_candidates(context: &Value) -> Vec<String> {
    let command = context
        .get("command")
        .or_else(|| context.get("cmd"))
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    tokenize_shellish(command)
        .into_iter()
        .filter(|token| looks_like_path_token(token))
        .collect()
}

fn tokenize_shellish(input: &str) -> Vec<String> {
    input
        .split(|ch: char| {
            ch.is_whitespace() || matches!(ch, '"' | '\'' | ',' | ';' | '(' | ')' | '[' | ']')
        })
        .filter_map(|part| {
            let token = part.trim();
            if token.is_empty() {
                None
            } else {
                Some(token.to_string())
            }
        })
        .collect()
}

fn looks_like_path_token(token: &str) -> bool {
    token.starts_with('/')
        || token.starts_with("./")
        || token.starts_with("../")
        || token == "."
        || token == ".."
        || token.contains('/')
}

fn path_is_within_root(root: &Path, candidate: &str) -> bool {
    if candidate.is_empty() {
        return true;
    }

    let root = normalize_path(root);
    let candidate_path = Path::new(candidate);
    let normalized = if candidate_path.is_absolute() {
        normalize_path(candidate_path)
    } else {
        normalize_path(&root.join(candidate_path))
    };
    normalized.starts_with(&root)
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::RootDir | Component::Prefix(_) | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    normalized
}

impl SecurityService {
    pub fn new(app: AppHandle, persistence: Arc<PersistenceService>) -> Self {
        let approvals = persistence
            .load_pending_approvals_sync()
            .unwrap_or_default()
            .into_iter()
            .map(|approval| (approval.request_id, approval))
            .collect();
        Self {
            app,
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

    pub async fn list_audit_log(
        &self,
        project_id: Option<&str>,
    ) -> Result<Vec<ApprovalAuditRecord>> {
        self.persistence.load_approval_audit_log(project_id).await
    }

    pub async fn upsert_approval(&self, approval: PendingApprovalRecord) -> Result<()> {
        self.approvals
            .write()
            .insert(approval.request_id, approval.clone());
        self.persistence
            .upsert_pending_approval(approval.clone())
            .await?;
        self.record_audit(approval, "requested").await
    }

    pub async fn record_policy_block(&self, approval: PendingApprovalRecord) -> Result<()> {
        self.record_audit(approval, "blocked").await
    }

    pub async fn resolve_approval(
        &self,
        request_id: u64,
        decision: &str,
    ) -> Result<Option<PendingApprovalRecord>> {
        let removed = self.approvals.write().remove(&request_id);
        self.persistence.delete_pending_approval(request_id).await?;
        if let Some(approval) = removed.clone() {
            self.record_audit(approval, decision).await?;
        }
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

    async fn record_audit(&self, approval: PendingApprovalRecord, decision: &str) -> Result<()> {
        let audit = self
            .persistence
            .append_approval_audit(approval, decision.to_string())
            .await?;
        let _ = self.app.emit(
            SECURITY_EVENT,
            serde_json::json!({ "type": "approvalAudit", "audit": audit }),
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_approval_policy, classify_approval, enforce_project_scope_policy,
        PendingApprovalRecord,
    };
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn classifies_destructive_shell_command_as_high_risk_command() {
        let payload = json!({ "command": "rm -rf /tmp/demo" });
        let (category, risk_level, title) = classify_approval("shell/exec", &payload);
        assert_eq!(category, "command");
        assert_eq!(risk_level, "high");
        assert_eq!(title, "Run Command");
    }

    #[test]
    fn blocks_destructive_shell_command_by_policy() {
        let payload = json!({ "command": "sudo rm -rf /" });
        let (policy_action, policy_reason) =
            apply_approval_policy("shell/exec", "command", "high", &payload);
        assert_eq!(policy_action, "block");
        assert!(policy_reason
            .expect("policy reason")
            .contains("Blocked destructive shell command"));
    }

    #[test]
    fn prompts_high_risk_filesystem_mutation() {
        let payload = json!({ "path": "src/main.rs" });
        let (policy_action, policy_reason) =
            apply_approval_policy("fs/delete", "filesystem", "high", &payload);
        assert_eq!(policy_action, "prompt");
        assert!(policy_reason
            .expect("policy reason")
            .contains("High-risk filesystem mutation"));
    }

    #[test]
    fn blocks_filesystem_path_outside_project_root() {
        let approval = PendingApprovalRecord {
            request_id: 7,
            project_id: "project-a".to_string(),
            thread_id: Some("thread-1".to_string()),
            action_type: "fs/write".to_string(),
            category: "filesystem".to_string(),
            risk_level: "medium".to_string(),
            policy_action: "prompt".to_string(),
            policy_reason: None,
            description: "Edit Files".to_string(),
            context_json: Some(json!({ "path": "../outside.txt" })),
        };

        let reason = enforce_project_scope_policy(&approval, Path::new("/tmp/project-a"));
        assert!(reason
            .expect("scope block")
            .contains("outside project root"));
    }

    #[test]
    fn blocks_command_with_absolute_path_outside_project_root() {
        let approval = PendingApprovalRecord {
            request_id: 8,
            project_id: "project-a".to_string(),
            thread_id: Some("thread-1".to_string()),
            action_type: "shell/exec".to_string(),
            category: "command".to_string(),
            risk_level: "medium".to_string(),
            policy_action: "prompt".to_string(),
            policy_reason: None,
            description: "Run Command".to_string(),
            context_json: Some(json!({ "command": "cat /tmp/outside.txt" })),
        };

        let reason = enforce_project_scope_policy(&approval, Path::new("/tmp/project-a"));
        assert!(reason
            .expect("scope block")
            .contains("outside project root"));
    }
}
