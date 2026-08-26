use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

use crate::browser::service::BrowserService;
use crate::codex::service::CodexService;
use crate::git::service::GitService;
use crate::persistence::db::PersistenceService;
use crate::projects::models::{
    BrowserRestorePolicy, ProjectBrowserSidebarItem, ProjectCodexSidebarItem, ProjectRecord,
    ProjectSummary,
};
use crate::security::approvals::SecurityService;
use crate::terminal::service::TerminalService;

pub struct ProjectService {
    persistence: Arc<PersistenceService>,
    git: Arc<GitService>,
    terminal: Arc<TerminalService>,
    browser: Arc<BrowserService>,
    codex: Arc<CodexService>,
    security: Arc<SecurityService>,
}

impl ProjectService {
    pub fn new(
        persistence: Arc<PersistenceService>,
        git: Arc<GitService>,
        terminal: Arc<TerminalService>,
        browser: Arc<BrowserService>,
        codex: Arc<CodexService>,
        security: Arc<SecurityService>,
    ) -> Self {
        Self {
            persistence,
            git,
            terminal,
            browser,
            codex,
            security,
        }
    }

    pub async fn add_project(&self, root_path: String, trusted: bool) -> Result<ProjectRecord> {
        let path = std::fs::canonicalize(&root_path)
            .with_context(|| format!("failed to resolve project path {root_path}"))?;
        if !path.is_dir() {
            return Err(anyhow!("project path is not a directory"));
        }
        let canonical_root = path.to_string_lossy().to_string();

        let persistence = self.persistence.clone();
        let canonical_root_for_lookup = canonical_root.clone();
        if let Some(mut existing) = tokio::task::spawn_blocking(move || {
            persistence.read_project_by_root_path_sync(&canonical_root_for_lookup)
        })
        .await??
        {
            existing.name = path
                .file_name()
                .and_then(|part| part.to_str())
                .unwrap_or("project")
                .to_string();
            existing.color_token = color_from_name(&canonical_root);
            existing.is_trusted = existing.is_trusted || trusted;
            existing.last_opened_at = chrono::Utc::now().to_rfc3339();

            let persistence = self.persistence.clone();
            let existing_clone = existing.clone();
            tokio::task::spawn_blocking(move || persistence.update_project_sync(&existing_clone))
                .await??;
            self.prepend_project_order(existing.id.clone()).await?;
            return Ok(existing);
        }

        let record = ProjectRecord {
            id: Uuid::new_v4().to_string(),
            name: path
                .file_name()
                .and_then(|part| part.to_str())
                .unwrap_or("project")
                .to_string(),
            root_path: canonical_root.clone(),
            color_token: color_from_name(&canonical_root),
            icon_hint: None,
            is_trusted: trusted,
            created_at: chrono::Utc::now().to_rfc3339(),
            last_opened_at: chrono::Utc::now().to_rfc3339(),
        };

        let persistence = self.persistence.clone();
        let cloned = record.clone();
        tokio::task::spawn_blocking(move || persistence.insert_project_sync(&cloned)).await??;
        self.prepend_project_order(record.id.clone()).await?;

        Ok(record)
    }

    pub async fn remove_project(&self, project_id: &str) -> Result<()> {
        let project_id = project_id.to_string();
        self.browser.remove_project_tabs(&project_id).await?;
        self.terminal.remove_project_sessions(&project_id).await?;
        self.codex.remove_project_threads(&project_id).await?;
        self.security.remove_project_approvals(&project_id).await?;
        let persistence = self.persistence.clone();
        let delete_project_id = project_id.clone();
        tokio::task::spawn_blocking(move || persistence.delete_project_sync(&delete_project_id))
            .await??;
        self.remove_project_order(&project_id).await?;
        self.persistence
            .config_delete(browser_restore_policy_key(&project_id))
            .await?;
        Ok(())
    }

    pub async fn reorder_projects(&self, project_ids: Vec<String>) -> Result<()> {
        let existing = self
            .list_project_records_unsorted()
            .await?
            .into_iter()
            .map(|project| project.id)
            .collect::<Vec<_>>();
        let order = normalize_project_order(project_ids, existing)?;
        self.persistence
            .config_set("projects.order".to_string(), serde_json::json!(order))
            .await
    }

    pub async fn list_projects(&self) -> Result<Vec<ProjectSummary>> {
        let records = self.list_project_records().await?;
        let mut out = Vec::with_capacity(records.len());

        for project in records {
            let git_branch = self.git.try_branch_name(&project).await.ok().flatten();
            let terminal_count = self.terminal.list(Some(&project.id)).await.len();
            let browser_tab_count = self.browser.list_tabs(Some(&project.id)).await.len();
            let codex_thread_count = self.codex.thread_count(&project.id).await;
            out.push(ProjectSummary {
                project,
                git_branch,
                terminal_count,
                browser_tab_count,
                codex_thread_count,
            });
        }

        Ok(out)
    }

    pub async fn require_project(&self, project_id: &str) -> Result<ProjectRecord> {
        self.list_project_records()
            .await?
            .into_iter()
            .find(|project| project.id == project_id)
            .ok_or_else(|| anyhow!("unknown project {project_id}"))
    }

    pub async fn resolve_project_path(&self, project_id: &str) -> Result<PathBuf> {
        Ok(PathBuf::from(
            self.require_project(project_id).await?.root_path,
        ))
    }

    pub async fn browser_restore_policy(&self, project_id: &str) -> Result<BrowserRestorePolicy> {
        let _ = self.require_project(project_id).await?;
        Ok(self
            .persistence
            .config_get(&browser_restore_policy_key(project_id))
            .await?
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default())
    }

    pub async fn set_browser_restore_policy(
        &self,
        project_id: &str,
        policy: BrowserRestorePolicy,
    ) -> Result<BrowserRestorePolicy> {
        let _ = self.require_project(project_id).await?;
        self.persistence
            .config_set(
                browser_restore_policy_key(project_id),
                serde_json::to_value(&policy)?,
            )
            .await?;
        Ok(policy)
    }

    pub async fn browser_sidebar_items(
        &self,
        project_id: &str,
    ) -> Result<Vec<ProjectBrowserSidebarItem>> {
        let _ = self.require_project(project_id).await?;
        Ok(self.browser.sidebar_tabs(project_id).await)
    }

    pub async fn codex_sidebar_items(
        &self,
        project_id: &str,
    ) -> Result<Vec<ProjectCodexSidebarItem>> {
        let _ = self.require_project(project_id).await?;
        Ok(self.codex.sidebar_threads(project_id).await)
    }

    async fn list_project_records(&self) -> Result<Vec<ProjectRecord>> {
        let records = self.list_project_records_unsorted().await?;
        let stored_order = self
            .persistence
            .config_get("projects.order")
            .await?
            .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
            .unwrap_or_default();
        Ok(order_projects(records, &stored_order))
    }

    async fn list_project_records_unsorted(&self) -> Result<Vec<ProjectRecord>> {
        let persistence = self.persistence.clone();
        tokio::task::spawn_blocking(move || persistence.load_projects_sync()).await?
    }

    async fn prepend_project_order(&self, project_id: String) -> Result<()> {
        let mut order = self
            .persistence
            .config_get("projects.order")
            .await?
            .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
            .unwrap_or_default();
        order.retain(|candidate| candidate != &project_id);
        order.insert(0, project_id);
        self.persistence
            .config_set("projects.order".to_string(), serde_json::json!(order))
            .await
    }

    async fn remove_project_order(&self, project_id: &str) -> Result<()> {
        let mut order = self
            .persistence
            .config_get("projects.order")
            .await?
            .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
            .unwrap_or_default();
        order.retain(|candidate| candidate != project_id);
        self.persistence
            .config_set("projects.order".to_string(), serde_json::json!(order))
            .await
    }
}

fn browser_restore_policy_key(project_id: &str) -> String {
    format!("browser.restorePolicy.{project_id}")
}

fn color_from_name(name: &str) -> String {
    let palette = ["blue", "green", "amber", "red", "teal", "indigo"];
    let idx = name.bytes().fold(0usize, |acc, value| acc + value as usize) % palette.len();
    palette[idx].to_string()
}

fn normalize_project_order(project_ids: Vec<String>, existing: Vec<String>) -> Result<Vec<String>> {
    let existing_set = existing
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let mut seen = std::collections::HashSet::new();
    let mut order = Vec::with_capacity(existing.len());
    for project_id in project_ids {
        if !existing_set.contains(&project_id) {
            return Err(anyhow!("unknown project {project_id}"));
        }
        if !seen.insert(project_id.clone()) {
            return Err(anyhow!("duplicate project {project_id}"));
        }
        order.push(project_id);
    }
    for project_id in existing {
        if !seen.contains(&project_id) {
            order.push(project_id);
        }
    }
    Ok(order)
}

fn order_projects(mut records: Vec<ProjectRecord>, stored_order: &[String]) -> Vec<ProjectRecord> {
    let mut ranking = stored_order
        .iter()
        .enumerate()
        .map(|(index, project_id)| (project_id.clone(), index))
        .collect::<std::collections::HashMap<_, _>>();
    let fallback_rank = ranking.len();
    records.sort_by_key(|project| {
        (
            ranking.remove(&project.id).unwrap_or(fallback_rank),
            project.last_opened_at.clone(),
        )
    });
    records
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_project_order_appends_missing_existing_projects() {
        let order = normalize_project_order(
            vec!["project-b".to_string()],
            vec!["project-a".to_string(), "project-b".to_string()],
        )
        .expect("valid project order");

        assert_eq!(order, vec!["project-b", "project-a"]);
    }

    #[test]
    fn normalize_project_order_rejects_unknown_projects() {
        let error = normalize_project_order(
            vec!["project-missing".to_string()],
            vec!["project-a".to_string()],
        )
        .expect_err("unknown project should fail");

        assert!(error
            .to_string()
            .contains("unknown project project-missing"));
    }

    #[test]
    fn normalize_project_order_rejects_duplicate_projects() {
        let error = normalize_project_order(
            vec!["project-a".to_string(), "project-a".to_string()],
            vec!["project-a".to_string()],
        )
        .expect_err("duplicate project should fail");

        assert!(error.to_string().contains("duplicate project project-a"));
    }
}
