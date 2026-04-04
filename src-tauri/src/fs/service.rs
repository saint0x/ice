use anyhow::{anyhow, Context, Result};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::app::events::FS_EVENT;
use crate::git::service::GitService;
use crate::projects::service::ProjectService;

pub struct FsService {
    app: AppHandle,
    watchers: Arc<Mutex<HashMap<String, ProjectWatcher>>>,
    last_git_refresh: Arc<Mutex<HashMap<String, Instant>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub depth: usize,
    pub git_status: Option<String>,
}

struct ProjectWatcher {
    root: PathBuf,
    watcher: RecommendedWatcher,
}

impl FsService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            watchers: Arc::new(Mutex::new(HashMap::new())),
            last_git_refresh: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn read_tree(
        &self,
        project_id: &str,
        relative_path: Option<&str>,
        max_depth: usize,
        projects: &ProjectService,
        git: &GitService,
    ) -> Result<Vec<FsEntry>> {
        let project = projects.require_project(project_id).await?;
        let root = PathBuf::from(&project.root_path);
        let start = match relative_path {
            Some(path) if !path.is_empty() => resolve_under_root(&root, path)?,
            _ => root.clone(),
        };
        let status_map = git.path_status_map(&project).await.unwrap_or_default();
        let entries =
            tokio::task::spawn_blocking(move || walk_tree(&root, &start, max_depth, &status_map))
                .await??;
        self.app.emit(
            FS_EVENT,
            serde_json::json!({ "type": "treeRead", "projectId": project_id, "count": entries.len() }),
        )?;
        Ok(entries)
    }

    pub async fn read_text_file(
        &self,
        project_id: &str,
        path: &str,
        projects: &ProjectService,
    ) -> Result<String> {
        let root = projects.resolve_project_path(project_id).await?;
        let full_path = resolve_under_root(&root, path)?;
        Ok(tokio::fs::read_to_string(full_path).await?)
    }

    pub async fn write_text_file(
        &self,
        project_id: &str,
        path: &str,
        content: &str,
        projects: &ProjectService,
    ) -> Result<()> {
        let root = projects.resolve_project_path(project_id).await?;
        let full_path = resolve_under_root(&root, path)?;
        if let Some(parent) = full_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&full_path, content).await?;
        self.app.emit(
            FS_EVENT,
            serde_json::json!({ "type": "fileWritten", "projectId": project_id, "path": path }),
        )?;
        Ok(())
    }

    pub async fn create_dir(
        &self,
        project_id: &str,
        path: &str,
        projects: &ProjectService,
    ) -> Result<()> {
        let root = projects.resolve_project_path(project_id).await?;
        let full_path = resolve_under_root(&root, path)?;
        tokio::fs::create_dir_all(&full_path).await?;
        self.app.emit(
            FS_EVENT,
            serde_json::json!({ "type": "dirCreated", "projectId": project_id, "path": path }),
        )?;
        Ok(())
    }

    pub async fn delete_entry(
        &self,
        project_id: &str,
        path: &str,
        recursive: bool,
        projects: &ProjectService,
    ) -> Result<()> {
        let root = projects.resolve_project_path(project_id).await?;
        let full_path = resolve_under_root(&root, path)?;
        let metadata = tokio::fs::metadata(&full_path).await?;
        if metadata.is_dir() {
            if recursive {
                tokio::fs::remove_dir_all(&full_path).await?;
            } else {
                tokio::fs::remove_dir(&full_path).await?;
            }
        } else {
            tokio::fs::remove_file(&full_path).await?;
        }
        self.app.emit(
            FS_EVENT,
            serde_json::json!({ "type": "entryDeleted", "projectId": project_id, "path": path }),
        )?;
        Ok(())
    }

    pub async fn rename_entry(
        &self,
        project_id: &str,
        from: &str,
        to: &str,
        projects: &ProjectService,
    ) -> Result<()> {
        let root = projects.resolve_project_path(project_id).await?;
        let from_path = resolve_under_root(&root, from)?;
        let to_path = resolve_under_root(&root, to)?;
        if let Some(parent) = to_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::rename(&from_path, &to_path).await?;
        self.app.emit(
            FS_EVENT,
            serde_json::json!({
                "type": "entryRenamed",
                "projectId": project_id,
                "from": from,
                "to": to
            }),
        )?;
        Ok(())
    }

    pub async fn start_watch(&self, project_id: &str, projects: &ProjectService) -> Result<()> {
        let root = projects.resolve_project_path(project_id).await?;
        let project_id = project_id.to_string();
        let emit_project_id = project_id.clone();
        let app = self.app.clone();
        let git_app = self.app.clone();
        let watch_root = root.clone();
        let git_root = root.clone();
        let last_git_refresh = self.last_git_refresh.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if let Ok(event) = event {
                    let paths = event
                        .paths
                        .iter()
                        .filter_map(|path| path.strip_prefix(&watch_root).ok())
                        .map(|path| path.to_string_lossy().to_string())
                        .collect::<Vec<_>>();
                    let kind = describe_event_kind(&event.kind);
                    let refresh_git = should_refresh_git(&event.kind, &paths);
                    let _ = app.emit(
                        FS_EVENT,
                        serde_json::json!({
                            "type": "watchEvent",
                            "projectId": emit_project_id,
                            "kind": kind,
                            "paths": paths
                        }),
                    );
                    if refresh_git {
                        let should_emit = {
                            let mut refreshes = last_git_refresh.lock();
                            let now = Instant::now();
                            match refreshes.get(&emit_project_id) {
                                Some(last_seen)
                                    if now.duration_since(*last_seen)
                                        < Duration::from_millis(250) =>
                                {
                                    false
                                }
                                _ => {
                                    refreshes.insert(emit_project_id.clone(), now);
                                    true
                                }
                            }
                        };
                        if should_emit {
                            GitService::schedule_status_refresh(
                                git_app.clone(),
                                emit_project_id.clone(),
                                git_root.to_string_lossy().to_string(),
                            );
                        }
                    }
                }
            })?;
        watcher.configure(Config::default())?;
        watcher.watch(&root, RecursiveMode::Recursive)?;
        self.watchers
            .lock()
            .insert(project_id.clone(), ProjectWatcher { root, watcher });
        self.app.emit(
            FS_EVENT,
            serde_json::json!({ "type": "watchStarted", "projectId": project_id }),
        )?;
        Ok(())
    }

    pub async fn stop_watch(&self, project_id: &str) -> Result<()> {
        if let Some(mut watcher) = self.watchers.lock().remove(project_id) {
            let _ = watcher.watcher.unwatch(&watcher.root);
        }
        self.app.emit(
            FS_EVENT,
            serde_json::json!({ "type": "watchStopped", "projectId": project_id }),
        )?;
        Ok(())
    }
}

fn resolve_under_root(root: &Path, relative: &str) -> Result<PathBuf> {
    let full = root.join(relative);
    let normalized = full.components().collect::<PathBuf>();
    if !normalized.starts_with(root) {
        return Err(anyhow!("path escapes project root"));
    }
    Ok(normalized)
}

fn walk_tree(
    root: &Path,
    start: &Path,
    max_depth: usize,
    status_map: &HashMap<String, String>,
) -> Result<Vec<FsEntry>> {
    let mut out = Vec::new();
    walk_tree_inner(root, start, 0, max_depth, status_map, &mut out)?;
    Ok(out)
}

fn walk_tree_inner(
    root: &Path,
    dir: &Path,
    depth: usize,
    max_depth: usize,
    status_map: &HashMap<String, String>,
    out: &mut Vec<FsEntry>,
) -> Result<()> {
    let entries = std::fs::read_dir(dir)
        .with_context(|| format!("failed to read directory {}", dir.display()))?;
    let mut children = entries.filter_map(|entry| entry.ok()).collect::<Vec<_>>();
    children.sort_by_key(|entry| entry.path());
    for child in children {
        let path = child.path();
        let metadata = child.metadata()?;
        let rel_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        out.push(FsEntry {
            path: rel_path.clone(),
            name: child.file_name().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            depth,
            git_status: status_map.get(&rel_path).cloned(),
        });
        if metadata.is_dir() && depth < max_depth {
            walk_tree_inner(root, &path, depth + 1, max_depth, status_map, out)?;
        }
    }
    Ok(())
}

fn describe_event_kind(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        EventKind::Any => "any",
        EventKind::Other => "other",
        EventKind::Access(_) => "access",
    }
}

fn should_refresh_git(kind: &EventKind, paths: &[String]) -> bool {
    if matches!(kind, EventKind::Access(_)) || paths.is_empty() {
        return false;
    }
    paths.iter().any(|path| path != ".git")
}
