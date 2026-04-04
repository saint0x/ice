mod app;
mod browser;
mod codex;
mod diagnostics;
mod fs;
mod git;
mod ipc;
mod persistence;
mod projects;
mod security;
mod terminal;
mod workspace;

use app::startup::build_state;
use ipc::commands;
use tauri::Manager;

pub fn run() {
    diagnostics::init_tracing();

    tauri::Builder::default()
        .setup(|app| {
            let state = build_state(app.handle().clone())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_health,
            commands::app_bootstrap,
            commands::app_config_get,
            commands::app_config_set,
            commands::project_add,
            commands::project_remove,
            commands::project_list,
            commands::project_reorder,
            commands::project_snapshot,
            commands::project_tree_read,
            commands::project_watch_start,
            commands::project_watch_stop,
            commands::file_read,
            commands::file_read_text,
            commands::file_search_paths,
            commands::file_search_text,
            commands::file_write_text,
            commands::dir_create,
            commands::entry_delete,
            commands::entry_rename,
            commands::workspace_layout_get,
            commands::workspace_layout_set,
            commands::workspace_chrome_get,
            commands::workspace_chrome_set,
            commands::workspace_session_get,
            commands::workspace_session_set,
            commands::git_status_read,
            commands::git_branches_list,
            commands::git_stage_paths,
            commands::git_unstage_paths,
            commands::git_commit,
            commands::git_branch_checkout,
            commands::git_fetch,
            commands::git_pull,
            commands::git_push,
            commands::git_diff_read,
            commands::browser_tab_create,
            commands::browser_tab_navigate,
            commands::browser_tab_back,
            commands::browser_tab_forward,
            commands::browser_tab_reload,
            commands::browser_tab_close,
            commands::browser_tabs_list,
            commands::browser_tab_history,
            commands::terminal_create,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
            commands::terminal_rename,
            commands::terminal_list,
            commands::codex_status,
            commands::codex_models_list,
            commands::codex_auth_read,
            commands::codex_login_start,
            commands::codex_thread_create,
            commands::codex_threads_list,
            commands::codex_turn_start,
            commands::codex_server_request_respond,
            commands::codex_approvals_list
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
