use tauri::{AppHandle, State};

use crate::app::state::AppState;
use crate::fs::service::TreeReadOptions;
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
        workspace_session: state.workspace.get_session_state("primary").await?,
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
pub async fn project_browser_restore_policy_get(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<crate::projects::models::BrowserRestorePolicy, AppError> {
    Ok(state.projects.browser_restore_policy(&project_id).await?)
}

#[tauri::command]
pub async fn project_browser_restore_policy_set(
    input: ProjectBrowserRestorePolicyInput,
    state: State<'_, AppState>,
) -> Result<crate::projects::models::BrowserRestorePolicy, AppError> {
    Ok(state
        .projects
        .set_browser_restore_policy(&input.project_id, input.policy)
        .await?)
}

#[tauri::command]
pub async fn project_browser_sidebar(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::projects::models::ProjectBrowserSidebarItem>, AppError> {
    Ok(state.projects.browser_sidebar_items(&project_id).await?)
}

#[tauri::command]
pub async fn project_codex_sidebar(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::projects::models::ProjectCodexSidebarItem>, AppError> {
    Ok(state.projects.codex_sidebar_items(&project_id).await?)
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
            TreeReadOptions {
                max_depth: input.depth.unwrap_or(2),
                include_hidden: input.include_hidden.unwrap_or(false),
                respect_gitignore: input.respect_gitignore.unwrap_or(true),
                max_entries: input.max_entries.unwrap_or(5_000),
            },
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
            TreeReadOptions {
                max_depth: input.tree_depth.unwrap_or(3),
                ..TreeReadOptions::default()
            },
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
pub async fn file_read(
    input: ReadFileInput,
    state: State<'_, AppState>,
) -> Result<crate::fs::service::FileReadResult, AppError> {
    Ok(state
        .fs
        .read_file(&input.project_id, &input.path, &state.projects)
        .await?)
}

#[tauri::command]
pub async fn file_search_paths(
    input: SearchInput,
    state: State<'_, AppState>,
) -> Result<crate::fs::service::FileSearchResult, AppError> {
    Ok(state
        .fs
        .search_paths(
            &input.project_id,
            &input.query,
            input.limit.unwrap_or(50),
            &state.projects,
        )
        .await?)
}

#[tauri::command]
pub async fn file_search_text(
    input: SearchInput,
    state: State<'_, AppState>,
) -> Result<crate::fs::service::ContentSearchResult, AppError> {
    Ok(state
        .fs
        .search_text(
            &input.project_id,
            &input.query,
            input.limit.unwrap_or(50),
            &state.projects,
        )
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
            input.expected_version_token.as_deref(),
            input.encoding.as_deref(),
            input.has_bom.unwrap_or(false),
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
pub async fn workspace_session_get(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<crate::workspace::service::WorkspaceSessionState, AppError> {
    Ok(state.workspace.get_session_state(&workspace_id).await?)
}

#[tauri::command]
pub async fn workspace_session_set(
    input: SetWorkspaceSessionInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .workspace
        .set_session_state(&input.workspace_id, input.session_state)
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
pub async fn git_branches_list(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::git::service::GitBranchRecord>, AppError> {
    let project = state.projects.require_project(&project_id).await?;
    Ok(state.git.list_branches(&project).await?)
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
pub async fn git_restore_paths(
    input: GitRestoreInput,
    state: State<'_, AppState>,
) -> Result<crate::git::service::GitStatusSummary, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    state
        .git
        .restore_paths(
            &project,
            &input.paths,
            input.staged.unwrap_or(false),
            input.worktree.unwrap_or(true),
        )
        .await?;
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
pub async fn git_commit_readiness(
    input: GitCommitReadinessInput,
    state: State<'_, AppState>,
) -> Result<crate::git::service::GitCommitReadiness, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    Ok(state
        .git
        .commit_readiness(&project, input.message.as_deref())
        .await?)
}

#[tauri::command]
pub async fn git_branch_checkout(
    input: GitBranchCheckoutInput,
    state: State<'_, AppState>,
) -> Result<crate::git::service::GitStatusSummary, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    Ok(state
        .git
        .checkout_branch(
            &project,
            &input.branch_name,
            input.create.unwrap_or(false),
            input.start_point.as_deref(),
        )
        .await?)
}

#[tauri::command]
pub async fn git_fetch(
    input: GitFetchInput,
    state: State<'_, AppState>,
) -> Result<crate::git::service::GitStatusSummary, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    Ok(state.git.fetch(&project, input.remote.as_deref()).await?)
}

#[tauri::command]
pub async fn git_pull(
    input: GitPullInput,
    state: State<'_, AppState>,
) -> Result<crate::git::service::GitStatusSummary, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    Ok(state
        .git
        .pull(&project, input.remote.as_deref(), input.branch.as_deref())
        .await?)
}

#[tauri::command]
pub async fn git_push(
    input: GitPushInput,
    state: State<'_, AppState>,
) -> Result<crate::git::service::GitStatusSummary, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    Ok(state
        .git
        .push(
            &project,
            input.remote.as_deref(),
            input.branch.as_deref(),
            input.set_upstream.unwrap_or(false),
        )
        .await?)
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
pub async fn git_diff_tree_read(
    input: GitDiffTreeInput,
    state: State<'_, AppState>,
) -> Result<Vec<crate::git::service::GitDiffRecord>, AppError> {
    let project = state.projects.require_project(&input.project_id).await?;
    Ok(state
        .git
        .read_diff_tree(&project, input.staged.unwrap_or(false))
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
pub async fn browser_tab_pin_set(
    input: BrowserTabPinInput,
    state: State<'_, AppState>,
) -> Result<crate::browser::service::BrowserTabRecord, AppError> {
    Ok(state
        .browser
        .set_pinned(&input.tab_id, input.is_pinned)
        .await?)
}

#[tauri::command]
pub async fn browser_tab_renderer_state_set(
    input: BrowserRendererStateInput,
    state: State<'_, AppState>,
) -> Result<crate::browser::service::BrowserTabRecord, AppError> {
    Ok(state
        .browser
        .sync_renderer_state(
            &input.tab_id,
            crate::browser::service::BrowserRendererUpdate {
                url: input.url,
                title: input.title,
                is_loading: input.is_loading,
                favicon_url: input.favicon_url,
                security_origin: input.security_origin,
                is_secure: input.is_secure,
                can_go_back: input.can_go_back,
                can_go_forward: input.can_go_forward,
            },
        )
        .await?)
}

#[tauri::command]
pub async fn browser_tab_open_external(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<crate::browser::service::BrowserExternalOpenRequest, AppError> {
    Ok(state.browser.request_open_external(&tab_id).await?)
}

#[tauri::command]
pub async fn browser_renderer_attach(
    input: BrowserRendererAttachInput,
    state: State<'_, AppState>,
) -> Result<crate::browser::service::BrowserRendererSession, AppError> {
    Ok(state
        .browser
        .attach_renderer(&input.tab_id, input.renderer_id, input.pane_id)
        .await?)
}

#[tauri::command]
pub async fn browser_renderer_detach(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.browser.detach_renderer(&tab_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn browser_renderer_session_get(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<Option<crate::browser::service::BrowserRendererSession>, AppError> {
    Ok(state.browser.renderer_session(&tab_id).await)
}

#[tauri::command]
pub async fn browser_find_in_page(
    input: BrowserFindInPageInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .browser
        .request_find_in_page(
            &input.tab_id,
            input.query,
            input.forward.unwrap_or(true),
            input.find_next.unwrap_or(false),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn browser_find_in_page_report(
    input: BrowserFindInPageResultInput,
    state: State<'_, AppState>,
) -> Result<crate::browser::service::BrowserFindInPageResult, AppError> {
    Ok(state
        .browser
        .report_find_in_page(
            &input.tab_id,
            input.query,
            input.matches,
            input.active_match_ordinal,
            input.final_update.unwrap_or(false),
        )
        .await?)
}

#[tauri::command]
pub async fn browser_download_request(
    input: BrowserDownloadRequestInput,
    state: State<'_, AppState>,
) -> Result<crate::browser::service::BrowserDownloadRequest, AppError> {
    Ok(state
        .browser
        .request_download(
            &input.tab_id,
            input.url,
            input.suggested_filename,
            input.mime_type,
        )
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
            input.startup_command,
            input.env_overrides,
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
pub async fn terminal_scrollback_read(
    input: TerminalScrollbackInput,
    state: State<'_, AppState>,
) -> Result<crate::terminal::service::TerminalScrollbackRecord, AppError> {
    Ok(state.terminal.scrollback(&input.session_id).await?)
}

#[tauri::command]
pub async fn terminal_respawn(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<crate::terminal::service::TerminalSessionRecord, AppError> {
    Ok(state.terminal.respawn(&session_id).await?)
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
pub async fn codex_restart(
    state: State<'_, AppState>,
) -> Result<crate::codex::service::CodexStatus, AppError> {
    Ok(state.codex.restart_process().await?)
}

#[tauri::command]
pub async fn codex_runtime_info(
    state: State<'_, AppState>,
) -> Result<crate::codex::service::CodexRuntimeInfo, AppError> {
    Ok(state.codex.runtime_info().await?)
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
pub async fn codex_server_request_deny(
    input: CodexServerRequestDenyInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .codex
        .deny_server_request(input.request_id, input.message)
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

#[tauri::command]
pub async fn approval_audit_list(
    project_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::security::approvals::ApprovalAuditRecord>, AppError> {
    Ok(state.security.list_audit_log(project_id.as_deref()).await?)
}
