use std::sync::Arc;

use anyhow::Result;
use tauri::AppHandle;

use crate::app::paths::IcePaths;
use crate::app::state::AppState;
use crate::browser::service::BrowserService;
use crate::codex::service::CodexService;
use crate::fs::service::FsService;
use crate::git::service::GitService;
use crate::persistence::db::PersistenceService;
use crate::projects::service::ProjectService;
use crate::security::approvals::SecurityService;
use crate::terminal::service::TerminalService;
use crate::workspace::service::WorkspaceService;

pub fn build_state(app: AppHandle) -> Result<AppState> {
    let paths = IcePaths::from_home_dir()?;
    paths.ensure_layout()?;

    let persistence = Arc::new(PersistenceService::new(paths.db_path().to_path_buf())?);
    tauri::async_runtime::block_on(async {
        persistence
            .config_set(
                "storage.root".to_string(),
                serde_json::json!(paths.root().to_string_lossy().to_string()),
            )
            .await?;
        persistence
            .config_set(
                "storage.db".to_string(),
                serde_json::json!(paths.db_path().to_string_lossy().to_string()),
            )
            .await?;
        persistence
            .config_set(
                "storage.concerns".to_string(),
                serde_json::json!({
                    "projects": paths.concern_dir("projects"),
                    "workspace": paths.concern_dir("workspace"),
                    "browser": paths.concern_dir("browser"),
                    "terminal": paths.concern_dir("terminal"),
                    "codex": paths.concern_dir("codex"),
                    "diagnostics": paths.concern_dir("diagnostics")
                }),
            )
            .await
    })?;
    let workspace = Arc::new(WorkspaceService::new(persistence.clone()));
    let fs = Arc::new(FsService::new(app.clone()));
    let git = Arc::new(GitService::new(app.clone()));
    let browser = Arc::new(BrowserService::new(app.clone(), persistence.clone()));
    let terminal = Arc::new(TerminalService::new(app.clone(), persistence.clone()));
    let codex = Arc::new(CodexService::new(
        app.clone(),
        persistence.clone(),
        paths.clone(),
    ));
    let security = Arc::new(SecurityService::new());
    let projects = Arc::new(ProjectService::new(
        persistence.clone(),
        git.clone(),
        terminal.clone(),
        browser.clone(),
        codex.clone(),
    ));

    Ok(AppState {
        paths,
        persistence,
        projects,
        workspace,
        fs,
        git,
        browser,
        terminal,
        codex,
        security,
    })
}
