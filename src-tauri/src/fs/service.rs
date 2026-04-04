use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

use crate::app::events::FS_EVENT;
use crate::projects::service::ProjectService;

pub struct FsService {
    app: AppHandle,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub depth: usize,
}

impl FsService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub async fn read_tree(
        &self,
        project_id: &str,
        relative_path: Option<&str>,
        max_depth: usize,
        projects: &ProjectService,
    ) -> Result<Vec<FsEntry>> {
        let root = projects.resolve_project_path(project_id).await?;
        let start = match relative_path {
            Some(path) if !path.is_empty() => resolve_under_root(&root, path)?,
            _ => root.clone(),
        };
        let entries =
            tokio::task::spawn_blocking(move || walk_tree(&root, &start, max_depth)).await??;
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
}

fn resolve_under_root(root: &Path, relative: &str) -> Result<PathBuf> {
    let full = root.join(relative);
    let normalized = full.components().collect::<PathBuf>();
    if !normalized.starts_with(root) {
        return Err(anyhow!("path escapes project root"));
    }
    Ok(normalized)
}

fn walk_tree(root: &Path, start: &Path, max_depth: usize) -> Result<Vec<FsEntry>> {
    let mut out = Vec::new();
    walk_tree_inner(root, start, 0, max_depth, &mut out)?;
    Ok(out)
}

fn walk_tree_inner(
    root: &Path,
    dir: &Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<FsEntry>,
) -> Result<()> {
    let entries = std::fs::read_dir(dir)
        .with_context(|| format!("failed to read directory {}", dir.display()))?;
    let mut children = entries.filter_map(|entry| entry.ok()).collect::<Vec<_>>();
    children.sort_by_key(|entry| entry.path());
    for child in children {
        let path = child.path();
        let metadata = child.metadata()?;
        out.push(FsEntry {
            path: path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string(),
            name: child.file_name().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            depth,
        });
        if metadata.is_dir() && depth < max_depth {
            walk_tree_inner(root, &path, depth + 1, max_depth, out)?;
        }
    }
    Ok(())
}
