use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

use crate::browser::service::BrowserService;
use crate::codex::service::CodexService;
use crate::git::service::GitService;
use crate::persistence::db::PersistenceService;
use crate::projects::models::{ProjectRecord, ProjectSummary};
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

        Ok(record)
    }

    pub async fn remove_project(&self, project_id: &str) -> Result<()> {
        let project_id = project_id.to_string();
        self.browser.remove_project_tabs(&project_id).await?;
        self.terminal.remove_project_sessions(&project_id).await?;
        self.codex.remove_project_threads(&project_id).await?;
        self.security.remove_project_approvals(&project_id).await?;
        let persistence = self.persistence.clone();
        tokio::task::spawn_blocking(move || persistence.delete_project_sync(&project_id)).await??;
        Ok(())
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

    async fn list_project_records(&self) -> Result<Vec<ProjectRecord>> {
        let persistence = self.persistence.clone();
        tokio::task::spawn_blocking(move || persistence.load_projects_sync()).await?
    }
}

fn color_from_name(name: &str) -> String {
    let palette = ["blue", "green", "amber", "red", "teal", "indigo"];
    let idx = name.bytes().fold(0usize, |acc, value| acc + value as usize) % palette.len();
    palette[idx].to_string()
}
