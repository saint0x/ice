use std::sync::Arc;

use crate::app::paths::IcePaths;
use crate::browser::service::BrowserService;
use crate::codex::service::CodexService;
use crate::fs::service::FsService;
use crate::git::service::GitService;
use crate::persistence::db::PersistenceService;
use crate::projects::service::ProjectService;
use crate::security::approvals::SecurityService;
use crate::terminal::service::TerminalService;
use crate::workspace::service::WorkspaceService;

#[allow(dead_code)]
pub struct AppState {
    pub paths: IcePaths,
    pub persistence: Arc<PersistenceService>,
    pub projects: Arc<ProjectService>,
    pub workspace: Arc<WorkspaceService>,
    pub fs: Arc<FsService>,
    pub git: Arc<GitService>,
    pub browser: Arc<BrowserService>,
    pub terminal: Arc<TerminalService>,
    pub codex: Arc<CodexService>,
    pub security: Arc<SecurityService>,
}
