use tauri::{AppHandle, State};

use crate::app::state::AppState;
use crate::ipc::dto::*;
use crate::ipc::errors::AppError;

#[tauri::command]
pub async fn app_health(app: AppHandle, state: State<'_, AppState>) -> Result<HealthDto, AppError> {
    Ok(HealthDto {
        ok: true,
        app_version: app.package_info().version.to_string(),
        codex_available: state.codex.codex_available().await,
    })
}

#[tauri::command]
pub async fn app_bootstrap(state: State<'_, AppState>) -> Result<AppBootstrapDto, AppError> {
    Ok(AppBootstrapDto {
        storage_root: state.paths.root().to_string_lossy().to_string(),
        db_path: state.paths.db_path().to_string_lossy().to_string(),
        projects: state.projects.list_projects().await?,
        workspace_layout: state.workspace.get_layout("primary").await?,
        workspace_chrome: state.workspace.get_chrome_state("primary").await?,
    })
}

#[tauri::command]
pub async fn app_config_get(
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, AppError> {
    Ok(state.persistence.config_get(&key).await?)
}

#[tauri::command]
pub async fn app_config_set(
    input: AppConfigSetInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.persistence.config_set(input.key, input.value).await?;
    Ok(())
}

#[tauri::command]
pub async fn project_add(
    input: AddProjectInput,
    state: State<'_, AppState>,
) -> Result<crate::projects::models::ProjectRecord, AppError> {
    Ok(state
        .projects
        .add_project(input.root_path, input.trusted.unwrap_or(false))
        .await?)
}

#[tauri::command]
pub async fn project_remove(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.projects.remove_project(&project_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn project_list(
    state: State<'_, AppState>,
) -> Result<Vec<crate::projects::models::ProjectSummary>, AppError> {
    Ok(state.projects.list_projects().await?)
}

#[tauri::command]
pub async fn project_reorder(
    input: ReorderProjectsInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.projects.reorder_projects(input.project_ids).await?;
    Ok(())
}

#[tauri::command]
pub async fn project_tree_read(
    input: ReadTreeInput,
    state: State<'_, AppState>,
) -> Result<Vec<crate::fs::service::FsEntry>, AppError> {
    Ok(state
        .fs
        .read_tree(
            &input.project_id,
            input.path.as_deref(),
            input.depth.unwrap_or(2),
            &state.projects,
            &state.git,
        )
        .await?)
}

#[tauri::command]
pub async fn project_snapshot(
    input: ProjectSnapshotInput,
    state: State<'_, AppState>,
) -> Result<ProjectSnapshotDto, AppError> {
    let project_summary = state
        .projects
        .list_projects()
        .await?
        .into_iter()
        .find(|project| project.project.id == input.project_id)
        .ok_or_else(|| AppError::from(anyhow::anyhow!("unknown project {}", input.project_id)))?;
    let git = state.git.read_status(&project_summary.project).await?;
    let tree = state
        .fs
        .read_tree(
            &input.project_id,
            None,
            input.tree_depth.unwrap_or(3),
            &state.projects,
            &state.git,
        )
        .await?;
    let browser_tabs = state.browser.list_tabs(Some(&input.project_id)).await;
    let terminal_sessions = state.terminal.list(Some(&input.project_id)).await;
    let codex_threads = state.codex.list_threads(Some(&input.project_id)).await;
    let approvals = state.security.list_approvals(Some(&input.project_id)).await;
    Ok(ProjectSnapshotDto {
        project: project_summary,
        tree,
        git,
        browser_tabs,
        terminal_sessions,
        codex_threads,
        approvals,
    })
}

#[tauri::command]
pub async fn file_read_text(
    input: ReadFileInput,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    Ok(state
        .fs
        .read_text_file(&input.project_id, &input.path, &state.projects)
        .await?)
}

#[tauri::command]
pub async fn file_write_text(
    input: WriteFileInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .fs
        .write_text_file(
            &input.project_id,
            &input.path,
            &input.content,
            &state.projects,
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn dir_create(input: CreateDirInput, state: State<'_, AppState>) -> Result<(), AppError> {
    state
        .fs
        .create_dir(&input.project_id, &input.path, &state.projects)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn entry_delete(
    input: DeleteEntryInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .fs
        .delete_entry(
            &input.project_id,
            &input.path,
            input.recursive.unwrap_or(false),
            &state.projects,
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn entry_rename(
    input: RenameEntryInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .fs
        .rename_entry(&input.project_id, &input.from, &input.to, &state.projects)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn project_watch_start(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.fs.start_watch(&project_id, &state.projects).await?;
    Ok(())
}

#[tauri::command]
pub async fn project_watch_stop(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.fs.stop_watch(&project_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn workspace_layout_get(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, AppError> {
    Ok(state.workspace.get_layout(&workspace_id).await?)
}

#[tauri::command]
pub async fn workspace_layout_set(
    input: SetWorkspaceLayoutInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .workspace
        .set_layout(&input.workspace_id, input.layout_json)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn workspace_chrome_get(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<crate::workspace::service::WorkspaceChromeState, AppError> {
    Ok(state.workspace.get_chrome_state(&workspace_id).await?)
}

#[tauri::command]
pub async fn workspace_chrome_set(
    input: SetWorkspaceChromeInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .workspace
        .set_chrome_state(&input.workspace_id, input.chrome_state)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn git_status_read(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<crate::git::service::GitStatusSummary, AppError> {
    let project = state.projects.require_project(&project_id).await?;
    Ok(state.git.read_status(&project).await?)
}

#[tauri::command]
pub async fn git_stage_paths(
    input: GitPathsInput,
    state: State<'_, AppState>,
) -> Result<crate::git::service::GitStatusSummary, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    state.git.stage_paths(&project, &input.paths).await?;
    Ok(state.git.read_status(&project).await?)
}

#[tauri::command]
pub async fn git_unstage_paths(
    input: GitPathsInput,
    state: State<'_, AppState>,
) -> Result<crate::git::service::GitStatusSummary, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    state.git.unstage_paths(&project, &input.paths).await?;
    Ok(state.git.read_status(&project).await?)
}

#[tauri::command]
pub async fn git_commit(
    input: GitCommitInput,
    state: State<'_, AppState>,
) -> Result<crate::git::service::GitStatusSummary, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    Ok(state.git.commit(&project, &input.message).await?)
}

#[tauri::command]
pub async fn git_diff_read(
    input: GitDiffInput,
    state: State<'_, AppState>,
) -> Result<crate::git::service::GitDiffRecord, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    Ok(state
        .git
        .read_diff(&project, &input.path, input.staged.unwrap_or(false))
        .await?)
}

#[tauri::command]
pub async fn browser_tab_create(
    input: BrowserTabCreateInput,
    state: State<'_, AppState>,
) -> Result<crate::browser::service::BrowserTabRecord, AppError> {
    Ok(state
        .browser
        .create_tab(input.project_id, input.url, input.title)
        .await?)
}

#[tauri::command]
pub async fn browser_tab_navigate(
    input: BrowserTabNavigateInput,
    state: State<'_, AppState>,
) -> Result<crate::browser::service::BrowserTabRecord, AppError> {
    Ok(state
        .browser
        .navigate_tab(&input.tab_id, input.url, input.title)
        .await?)
}

#[tauri::command]
pub async fn browser_tab_back(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<crate::browser::service::BrowserTabRecord, AppError> {
    Ok(state.browser.go_back(&tab_id).await?)
}

#[tauri::command]
pub async fn browser_tab_forward(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<crate::browser::service::BrowserTabRecord, AppError> {
    Ok(state.browser.go_forward(&tab_id).await?)
}

#[tauri::command]
pub async fn browser_tab_reload(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<crate::browser::service::BrowserTabRecord, AppError> {
    Ok(state.browser.reload(&tab_id).await?)
}

#[tauri::command]
pub async fn browser_tab_close(tab_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.browser.close_tab(&tab_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn browser_tabs_list(
    project_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::browser::service::BrowserTabRecord>, AppError> {
    Ok(state.browser.list_tabs(project_id.as_deref()).await)
}

#[tauri::command]
pub async fn browser_tab_history(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::browser::service::BrowserHistoryEntry>, AppError> {
    Ok(state.browser.history(&tab_id).await?)
}

#[tauri::command]
pub async fn terminal_create(
    input: TerminalCreateInput,
    state: State<'_, AppState>,
) -> Result<crate::terminal::service::TerminalSessionRecord, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    Ok(state
        .terminal
        .create_session(
            project,
            input.cwd,
            input.shell,
            input.title,
            input.cols.unwrap_or(120),
            input.rows.unwrap_or(32),
        )
        .await?)
}

#[tauri::command]
pub async fn terminal_write(
    input: TerminalWriteInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.terminal.write(&input.session_id, &input.data).await?;
    Ok(())
}

#[tauri::command]
pub async fn terminal_resize(
    input: TerminalResizeInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .terminal
        .resize(&input.session_id, input.cols, input.rows)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn terminal_close(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.terminal.close(&session_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn terminal_rename(
    input: TerminalRenameInput,
    state: State<'_, AppState>,
) -> Result<crate::terminal::service::TerminalSessionRecord, AppError> {
    Ok(state
        .terminal
        .rename(&input.session_id, &input.title)
        .await?)
}

#[tauri::command]
pub async fn terminal_list(
    project_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::terminal::service::TerminalSessionRecord>, AppError> {
    Ok(state.terminal.list(project_id.as_deref()).await)
}

#[tauri::command]
pub async fn codex_status(
    state: State<'_, AppState>,
) -> Result<crate::codex::service::CodexStatus, AppError> {
    Ok(state.codex.status().await)
}

#[tauri::command]
pub async fn codex_models_list(
    state: State<'_, AppState>,
) -> Result<Vec<crate::codex::service::CodexModel>, AppError> {
    Ok(state.codex.models_list().await?)
}

#[tauri::command]
pub async fn codex_auth_read(state: State<'_, AppState>) -> Result<serde_json::Value, AppError> {
    Ok(state.codex.auth_read().await?)
}

#[tauri::command]
pub async fn codex_login_start(
    input: CodexLoginStartInput,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    Ok(state.codex.login_start(input.mode, input.api_key).await?)
}

#[tauri::command]
pub async fn codex_thread_create(
    input: CodexThreadCreateInput,
    state: State<'_, AppState>,
) -> Result<crate::codex::service::CodexThreadBinding, AppError> {
    Ok(state
        .codex
        .thread_create(input.project_id, input.title, input.model)
        .await?)
}

#[tauri::command]
pub async fn codex_threads_list(
    project_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::codex::service::CodexThreadBinding>, AppError> {
    Ok(state.codex.list_threads(project_id.as_deref()).await)
}

#[tauri::command]
pub async fn codex_turn_start(
    input: CodexTurnStartInput,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    Ok(state
        .codex
        .turn_start(input.project_id, input.thread_id, input.prompt, input.model)
        .await?)
}

#[tauri::command]
pub async fn codex_server_request_respond(
    input: CodexServerRequestRespondInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .codex
        .respond_to_server_request(input.request_id, input.result)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn codex_approvals_list(
    project_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::security::approvals::PendingApprovalRecord>, AppError> {
    Ok(state.security.list_approvals(project_id.as_deref()).await)
}
