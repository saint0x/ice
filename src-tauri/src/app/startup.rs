use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
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
use crate::syntax::service::SyntaxService;
use crate::terminal::service::TerminalService;
use crate::workspace::service::WorkspaceService;

const MAX_STARTUP_LOG_BYTES: u64 = 8 * 1024 * 1024;

pub fn build_state(app: AppHandle) -> Result<AppState> {
    let paths = IcePaths::from_app(&app)?;
    paths.ensure_layout()?;
    prepare_storage_root_for_startup(&paths)?;
    sync_codex_home_prerequisites(&paths.concern_dir("codex"))?;

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
    let browser = Arc::new(BrowserService::new(
        app.clone(),
        persistence.clone(),
        paths.concern_dir("browser"),
    ));
    let terminal = Arc::new(TerminalService::new(app.clone(), persistence.clone()));
    let security = Arc::new(SecurityService::new(app.clone(), persistence.clone()));
    let syntax = Arc::new(SyntaxService::new());
    let codex = Arc::new(CodexService::new(
        app.clone(),
        persistence.clone(),
        paths.clone(),
        security.clone(),
    )?);
    let projects = Arc::new(ProjectService::new(
        persistence.clone(),
        git.clone(),
        terminal.clone(),
        browser.clone(),
        codex.clone(),
        security.clone(),
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
        syntax,
    })
}

fn prepare_storage_root_for_startup(paths: &IcePaths) -> Result<()> {
    trim_startup_log(&paths.concern_dir("diagnostics").join("frontend.log"))?;
    trim_startup_log(&paths.concern_dir("diagnostics").join("backend.log"))?;
    trim_startup_log(&paths.concern_dir("diagnostics").join("frontend.log.1"))?;
    trim_startup_log(&paths.concern_dir("diagnostics").join("backend.log.1"))?;

    let wal_path = paths.db_path().with_file_name("ice.db-wal");
    if wal_path
        .metadata()
        .map(|metadata| metadata.len() == 0)
        .unwrap_or(false)
    {
        let _ = std::fs::remove_file(wal_path);
    }

    Ok(())
}

fn trim_startup_log(path: &Path) -> Result<()> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };

    if metadata.len() <= MAX_STARTUP_LOG_BYTES {
        return Ok(());
    }

    std::fs::write(path, [])?;
    Ok(())
}

fn sync_codex_home_prerequisites(target_codex_home: &Path) -> Result<()> {
    let Some(home_dir) = dirs::home_dir() else {
        return Ok(());
    };
    let source_codex_home = home_dir.join(".codex");
    if !source_codex_home.is_dir() {
        return Ok(());
    }

    for relative_path in [
        "auth.json",
        "config.toml",
        "version.json",
        "installation_id",
    ] {
        sync_file_if_needed(
            &source_codex_home.join(relative_path),
            &target_codex_home.join(relative_path),
        )?;
    }

    Ok(())
}

fn sync_file_if_needed(source: &Path, target: &Path) -> Result<()> {
    if !source.is_file() {
        return Ok(());
    }
    let should_copy = if !target.exists() {
        true
    } else {
        let source_modified = source.metadata()?.modified().ok();
        let target_modified = target.metadata()?.modified().ok();
        match (source_modified, target_modified) {
            (Some(source_modified), Some(target_modified)) => source_modified > target_modified,
            (Some(_), None) => true,
            _ => false,
        }
    };
    if !should_copy {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(source, target).with_context(|| {
        format!(
            "failed to sync Codex runtime file from '{}' to '{}'",
            source.display(),
            target.display()
        )
    })?;
    Ok(())
}
