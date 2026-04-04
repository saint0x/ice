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

        let record = ProjectRecord {
            id: Uuid::new_v4().to_string(),
            name: path
                .file_name()
                .and_then(|part| part.to_str())
                .unwrap_or("project")
                .to_string(),
            root_path: path.to_string_lossy().to_string(),
            color_token: color_from_name(path.to_string_lossy().as_ref()),
            icon_hint: None,
            is_trusted: trusted,
            created_at: chrono::Utc::now().to_rfc3339(),
            last_opened_at: chrono::Utc::now().to_rfc3339(),
        };

        let db = self.persistence.path().clone();
        let persistence = self.persistence.clone();
        let cloned = record.clone();
        let _ = db;
        tokio::task::spawn_blocking(move || persistence.insert_project_sync(&cloned)).await??;
        self.append_project_order(record.id.clone()).await?;

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
        Ok(())
    }

    pub async fn reorder_projects(&self, project_ids: Vec<String>) -> Result<()> {
        let existing = self
            .list_project_records_unsorted()
            .await?
            .into_iter()
            .map(|project| project.id)
            .collect::<Vec<_>>();
        for project_id in &project_ids {
            if !existing.iter().any(|existing_id| existing_id == project_id) {
                return Err(anyhow!("unknown project {project_id}"));
            }
        }
        let mut order = project_ids;
        for project_id in existing {
            if !order.iter().any(|candidate| candidate == &project_id) {
                order.push(project_id);
            }
        }
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

    async fn append_project_order(&self, project_id: String) -> Result<()> {
        let mut order = self
            .persistence
            .config_get("projects.order")
            .await?
            .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
            .unwrap_or_default();
        if !order.iter().any(|candidate| candidate == &project_id) {
            order.push(project_id);
        }
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
