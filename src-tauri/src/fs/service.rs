use anyhow::{anyhow, Context, Result};
use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_8};
use ignore::WalkBuilder;
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

use crate::app::events::FS_EVENT;
use crate::git::service::GitService;
use crate::projects::service::ProjectService;

const DEFAULT_TREE_DEPTH: usize = 2;
const DEFAULT_TREE_MAX_ENTRIES: usize = 5_000;
const MAX_BINARY_SNIFF_BYTES: usize = 8 * 1024;

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
    pub is_hidden: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsTreeNode {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub depth: usize,
    pub git_status: Option<String>,
    pub is_hidden: bool,
    pub children: Vec<FsTreeNode>,
}

#[derive(Debug, Clone)]
pub struct TreeReadOptions {
    pub max_depth: usize,
    pub include_hidden: bool,
    pub respect_gitignore: bool,
    pub max_entries: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadResult {
    pub path: String,
    pub content: Option<String>,
    pub is_binary: bool,
    pub size_bytes: u64,
    pub encoding: Option<String>,
    pub has_bom: bool,
    pub modified_at_ms: Option<u128>,
    pub version_token: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub query: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchMatch {
    pub path: String,
    pub line_number: usize,
    pub line: String,
    pub submatches: Vec<ContentSearchSubmatch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchSubmatch {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResult {
    pub query: String,
    pub matches: Vec<ContentSearchMatch>,
}

struct ProjectWatcher {
    root: PathBuf,
    watcher: RecommendedWatcher,
}

struct FileVersion {
    modified_at_ms: Option<u128>,
    token: String,
}

struct DecodedText {
    content: String,
    encoding: &'static Encoding,
    has_bom: bool,
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
        options: TreeReadOptions,
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
            tokio::task::spawn_blocking(move || walk_tree(&root, &start, &options, &status_map))
                .await??;
        self.app.emit(
            FS_EVENT,
            serde_json::json!({ "type": "treeRead", "projectId": project_id, "count": entries.len() }),
        )?;
        Ok(entries)
    }

    pub async fn read_tree_nested(
        &self,
        project_id: &str,
        relative_path: Option<&str>,
        options: TreeReadOptions,
        projects: &ProjectService,
        git: &GitService,
    ) -> Result<Vec<FsTreeNode>> {
        let entries = self
            .read_tree(project_id, relative_path, options, projects, git)
            .await?;
        Ok(nest_tree_entries(entries))
    }

    pub async fn read_file(
        &self,
        project_id: &str,
        path: &str,
        projects: &ProjectService,
    ) -> Result<FileReadResult> {
        let root = projects.resolve_project_path(project_id).await?;
        let full_path = resolve_under_root(&root, path)?;
        let metadata = tokio::fs::metadata(&full_path).await?;
        let version = file_version(&metadata);
        let bytes = tokio::fs::read(&full_path).await?;
        let size_bytes = bytes.len() as u64;
        if is_binary_bytes(&bytes) {
            return Ok(FileReadResult {
                path: path.to_string(),
                content: None,
                is_binary: true,
                size_bytes,
                encoding: None,
                has_bom: false,
                modified_at_ms: version.as_ref().and_then(|version| version.modified_at_ms),
                version_token: version.as_ref().map(|version| version.token.clone()),
            });
        }

        let decoded = decode_text_bytes(&bytes)?;
        Ok(FileReadResult {
            path: path.to_string(),
            content: Some(decoded.content),
            is_binary: false,
            size_bytes,
            encoding: Some(decoded.encoding.name().to_ascii_lowercase()),
            has_bom: decoded.has_bom,
            modified_at_ms: version.as_ref().and_then(|version| version.modified_at_ms),
            version_token: version.as_ref().map(|version| version.token.clone()),
        })
    }

    pub async fn read_text_file(
        &self,
        project_id: &str,
        path: &str,
        projects: &ProjectService,
    ) -> Result<String> {
        let result = self.read_file(project_id, path, projects).await?;
        if result.is_binary {
            return Err(anyhow!(
                "binary files must be handled through file_read metadata"
            ));
        }
        result
            .content
            .ok_or_else(|| anyhow!("text file content was unexpectedly empty"))
    }

    pub async fn search_paths(
        &self,
        project_id: &str,
        query: &str,
        limit: usize,
        projects: &ProjectService,
    ) -> Result<FileSearchResult> {
        let root = projects.resolve_project_path(project_id).await?;
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return Ok(FileSearchResult {
                query,
                paths: Vec::new(),
            });
        }

        let query_for_search = query.clone();
        let paths = tokio::task::spawn_blocking(move || {
            search_paths_under_root(&root, &query_for_search, limit)
        })
        .await??;
        Ok(FileSearchResult { query, paths })
    }

    pub async fn search_text(
        &self,
        project_id: &str,
        query: &str,
        limit: usize,
        projects: &ProjectService,
    ) -> Result<ContentSearchResult> {
        let root = projects.resolve_project_path(project_id).await?;
        let query = query.trim().to_string();
        if query.is_empty() {
            return Ok(ContentSearchResult {
                query,
                matches: Vec::new(),
            });
        }

        let matches = search_text_with_rg(&root, &query, limit).await?;
        Ok(ContentSearchResult { query, matches })
    }

    pub async fn write_text_file(
        &self,
        project_id: &str,
        path: &str,
        content: &str,
        expected_version_token: Option<&str>,
        encoding_name: Option<&str>,
        has_bom: bool,
        projects: &ProjectService,
    ) -> Result<()> {
        let root = projects.resolve_project_path(project_id).await?;
        let full_path = resolve_under_root(&root, path)?;
        if let Some(expected_version_token) = expected_version_token {
            let metadata = tokio::fs::metadata(&full_path).await.with_context(|| {
                format!(
                    "failed to read file metadata before saving {}",
                    full_path.display()
                )
            })?;
            let actual = file_version(&metadata)
                .ok_or_else(|| anyhow!("failed to derive a stable version token for {}", path))?;
            if actual.token != expected_version_token {
                return Err(anyhow!(
                    "save conflict: {} changed on disk since it was opened",
                    path
                ));
            }
        }
        if let Some(parent) = full_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let encoded = encode_text_content(content, encoding_name, has_bom)?;
        tokio::fs::write(&full_path, encoded).await?;
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

impl Default for TreeReadOptions {
    fn default() -> Self {
        Self {
            max_depth: DEFAULT_TREE_DEPTH,
            include_hidden: false,
            respect_gitignore: true,
            max_entries: DEFAULT_TREE_MAX_ENTRIES,
        }
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
    options: &TreeReadOptions,
    status_map: &HashMap<String, String>,
) -> Result<Vec<FsEntry>> {
    let mut out = Vec::new();
    let mut builder = WalkBuilder::new(start);
    builder
        .add_custom_ignore_filename(".gitignore")
        .hidden(!options.include_hidden)
        .git_ignore(options.respect_gitignore)
        .git_global(options.respect_gitignore)
        .git_exclude(options.respect_gitignore)
        .parents(options.respect_gitignore)
        .max_depth(Some(options.max_depth + 1))
        .follow_links(false);

    for entry in builder.build() {
        let entry = entry?;
        let path = entry.path();
        if path == start {
            continue;
        }
        let metadata = entry
            .metadata()
            .with_context(|| format!("failed to read metadata for {}", path.display()))?;
        let rel_path = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        if rel_path.is_empty() {
            continue;
        }

        let depth = path
            .strip_prefix(start)
            .unwrap_or(path)
            .components()
            .count()
            .saturating_sub(1);
        out.push(FsEntry {
            path: rel_path.clone(),
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            depth,
            git_status: status_map.get(&rel_path).cloned(),
            is_hidden: entry.file_name().to_string_lossy().starts_with('.'),
        });

        if out.len() >= options.max_entries {
            break;
        }
    }
    Ok(out)
}

fn nest_tree_entries(entries: Vec<FsEntry>) -> Vec<FsTreeNode> {
    fn build_nodes(
        entries: &[FsEntry],
        index: &mut usize,
        expected_depth: usize,
    ) -> Vec<FsTreeNode> {
        let mut out = Vec::new();
        while *index < entries.len() {
            let entry = &entries[*index];
            if entry.depth < expected_depth {
                break;
            }
            if entry.depth > expected_depth {
                *index += 1;
                continue;
            }

            let mut node = FsTreeNode {
                path: entry.path.clone(),
                name: entry.name.clone(),
                is_dir: entry.is_dir,
                depth: entry.depth,
                git_status: entry.git_status.clone(),
                is_hidden: entry.is_hidden,
                children: Vec::new(),
            };
            *index += 1;
            if node.is_dir {
                node.children = build_nodes(entries, index, expected_depth + 1);
            }
            out.push(node);
        }
        out
    }

    let mut index = 0;
    build_nodes(&entries, &mut index, 0)
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

fn decode_text_bytes(bytes: &[u8]) -> Result<DecodedText> {
    let (bom_encoding, bom_length) = detect_bom(bytes);
    let candidate_bytes = &bytes[bom_length..];
    let encoding = bom_encoding.unwrap_or_else(|| {
        if std::str::from_utf8(candidate_bytes).is_ok() {
            UTF_8
        } else {
            let mut detector = EncodingDetector::new();
            detector.feed(candidate_bytes, true);
            detector.guess(None, true)
        }
    });
    let (content, _, had_errors) = encoding.decode(candidate_bytes);
    if had_errors {
        return Err(anyhow!(
            "file could not be decoded safely with detected text encoding {}",
            encoding.name()
        ));
    }
    Ok(DecodedText {
        content: content.into_owned(),
        encoding,
        has_bom: bom_length > 0,
    })
}

fn encode_text_content(
    content: &str,
    encoding_name: Option<&str>,
    has_bom: bool,
) -> Result<Vec<u8>> {
    let encoding = match encoding_name.and_then(|name| Encoding::for_label(name.as_bytes())) {
        Some(encoding) => encoding,
        None => UTF_8,
    };
    let (encoded, _, had_errors) = encoding.encode(content);
    if had_errors {
        return Err(anyhow!(
            "content could not be encoded safely as {}",
            encoding.name()
        ));
    }
    let mut bytes = Vec::new();
    if has_bom {
        bytes.extend_from_slice(
            bom_bytes_for_encoding(encoding)
                .ok_or_else(|| anyhow!("BOM is not supported for encoding {}", encoding.name()))?,
        );
    }
    bytes.extend_from_slice(encoded.as_ref());
    Ok(bytes)
}

fn detect_bom(bytes: &[u8]) -> (Option<&'static Encoding>, usize) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (Some(UTF_8), 3);
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return (Encoding::for_label(b"utf-16le"), 2);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return (Encoding::for_label(b"utf-16be"), 2);
    }
    (None, 0)
}

fn bom_bytes_for_encoding(encoding: &'static Encoding) -> Option<&'static [u8]> {
    match encoding.name() {
        "UTF-8" => Some(&[0xEF, 0xBB, 0xBF]),
        "UTF-16LE" => Some(&[0xFF, 0xFE]),
        "UTF-16BE" => Some(&[0xFE, 0xFF]),
        _ => None,
    }
}

fn file_version(metadata: &std::fs::Metadata) -> Option<FileVersion> {
    let modified = metadata.modified().ok();
    let modified_at_ms = modified.as_ref().map(system_time_to_millis);
    let modified_nanos = modified
        .as_ref()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    Some(FileVersion {
        modified_at_ms,
        token: format!("{}:{}", metadata.len(), modified_nanos),
    })
}

fn system_time_to_millis(time: &SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn search_paths_under_root(root: &Path, query: &str, limit: usize) -> Result<Vec<String>> {
    let mut paths = Vec::new();
    let mut builder = WalkBuilder::new(root);
    builder
        .add_custom_ignore_filename(".gitignore")
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        .follow_links(false);

    for entry in builder.build() {
        let entry = entry?;
        let path = entry.path();
        if path == root {
            continue;
        }
        let rel_path = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        if entry
            .file_name()
            .to_string_lossy()
            .to_lowercase()
            .contains(query)
            || rel_path.to_lowercase().contains(query)
        {
            paths.push(rel_path);
            if paths.len() >= limit {
                break;
            }
        }
    }

    Ok(paths)
}

async fn search_text_with_rg(
    root: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<ContentSearchMatch>> {
    let output = Command::new("rg")
        .arg("--json")
        .arg("--hidden")
        .arg("--glob")
        .arg("!.git")
        .arg("--smart-case")
        .arg("--max-count")
        .arg(limit.to_string())
        .arg(query)
        .arg(root)
        .output()
        .await
        .context("failed to execute rg for project content search")?;

    if !output.status.success() && output.status.code() != Some(1) {
        return Err(anyhow!(
            "{}",
            String::from_utf8_lossy(&output.stderr).trim().to_string()
        ));
    }

    let mut matches = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some(record) = parse_rg_match_record(line, root) else {
            continue;
        };
        matches.push(record);
        if matches.len() >= limit {
            break;
        }
    }
    Ok(matches)
}

fn parse_rg_match_record(line: &str, root: &Path) -> Option<ContentSearchMatch> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    if value.get("type")?.as_str()? != "match" {
        return None;
    }
    let data = value.get("data")?;
    let path_text = data.get("path")?.get("text")?.as_str()?;
    let rel_path = Path::new(path_text)
        .strip_prefix(root)
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| path_text.to_string());
    let line_number = data.get("line_number")?.as_u64()? as usize;
    let line_text = data
        .get("lines")?
        .get("text")?
        .as_str()?
        .trim_end()
        .to_string();
    let submatches = data
        .get("submatches")?
        .as_array()?
        .iter()
        .filter_map(|submatch| {
            Some(ContentSearchSubmatch {
                start: submatch.get("start")?.as_u64()? as usize,
                end: submatch.get("end")?.as_u64()? as usize,
                text: submatch.get("match")?.get("text")?.as_str()?.to_string(),
            })
        })
        .collect::<Vec<_>>();
    Some(ContentSearchMatch {
        path: rel_path,
        line_number,
        line: line_text,
        submatches,
    })
}

fn is_binary_bytes(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(MAX_BINARY_SNIFF_BYTES)];
    sample.iter().any(|byte| *byte == 0)
}

#[cfg(test)]
mod tests {
    use super::{
        decode_text_bytes, encode_text_content, file_version, is_binary_bytes, nest_tree_entries,
        parse_rg_match_record, search_paths_under_root, walk_tree, FsEntry, TreeReadOptions,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;
    use std::thread::sleep;
    use std::time::Duration;
    use tempfile::tempdir;

    #[test]
    fn detects_binary_content_by_null_bytes() {
        assert!(is_binary_bytes(b"abc\0def"));
        assert!(!is_binary_bytes(b"plain utf8 text"));
    }

    #[test]
    fn tree_walk_respects_gitignore_and_hidden_defaults() {
        let temp = tempdir().expect("temp dir");
        let root = temp.path();
        fs::write(root.join(".gitignore"), "ignored.txt\n").expect("write gitignore");
        fs::write(root.join("visible.txt"), "visible").expect("write visible");
        fs::write(root.join("ignored.txt"), "ignored").expect("write ignored");
        fs::write(root.join(".hidden.txt"), "hidden").expect("write hidden");

        let entries =
            walk_tree(root, root, &TreeReadOptions::default(), &HashMap::new()).expect("walk tree");
        let paths = entries
            .into_iter()
            .map(|entry| entry.path)
            .collect::<Vec<_>>();
        assert!(paths.contains(&"visible.txt".to_string()));
        assert!(!paths.contains(&"ignored.txt".to_string()));
        assert!(!paths.contains(&".hidden.txt".to_string()));
    }

    #[test]
    fn path_search_respects_gitignore() {
        let temp = tempdir().expect("temp dir");
        let root = temp.path();
        fs::write(root.join(".gitignore"), "ignored.txt\n").expect("write gitignore");
        fs::write(root.join("src-main.ts"), "visible").expect("write visible");
        fs::write(root.join("ignored.txt"), "ignored").expect("write ignored");

        let paths = search_paths_under_root(root, "src", 20).expect("search paths");
        assert_eq!(paths, vec!["src-main.ts".to_string()]);
    }

    #[test]
    fn parses_rg_json_matches() {
        let root = Path::new("/tmp/project");
        let line = r#"{"type":"match","data":{"path":{"text":"/tmp/project/src/main.rs"},"lines":{"text":"fn main() {}\n"},"line_number":7,"absolute_offset":10,"submatches":[{"match":{"text":"main"},"start":3,"end":7}]}}"#;
        let record = parse_rg_match_record(line, root).expect("parsed match");
        assert_eq!(record.path, "src/main.rs");
        assert_eq!(record.line_number, 7);
        assert_eq!(record.submatches.len(), 1);
        assert_eq!(record.submatches[0].text, "main");
    }

    #[test]
    fn file_version_token_changes_after_write() {
        let temp = tempdir().expect("temp dir");
        let file_path = temp.path().join("main.rs");
        fs::write(&file_path, "one").expect("write one");
        let first =
            file_version(&fs::metadata(&file_path).expect("meta one")).expect("first version");
        sleep(Duration::from_millis(2));
        fs::write(&file_path, "two").expect("write two");
        let second =
            file_version(&fs::metadata(&file_path).expect("meta two")).expect("second version");
        assert_ne!(first.token, second.token);
    }

    #[test]
    fn decodes_utf8_bom_text() {
        let decoded = decode_text_bytes(&[0xEF, 0xBB, 0xBF, b'h', b'i']).expect("decode utf8 bom");
        assert_eq!(decoded.content, "hi");
        assert!(decoded.has_bom);
        assert_eq!(decoded.encoding.name(), "UTF-8");
    }

    #[test]
    fn encodes_utf16le_with_bom() {
        let encoded = encode_text_content("hi", Some("utf-16le"), true).expect("encode utf16le");
        assert_eq!(&encoded[..2], &[0xFF, 0xFE]);
        assert!(encoded.len() > 2);
    }

    #[test]
    fn nests_flat_tree_entries_into_directory_hierarchy() {
        let tree = nest_tree_entries(vec![
            FsEntry {
                path: "src".to_string(),
                name: "src".to_string(),
                is_dir: true,
                depth: 0,
                git_status: None,
                is_hidden: false,
            },
            FsEntry {
                path: "src/lib.rs".to_string(),
                name: "lib.rs".to_string(),
                is_dir: false,
                depth: 1,
                git_status: Some("modified".to_string()),
                is_hidden: false,
            },
            FsEntry {
                path: "README.md".to_string(),
                name: "README.md".to_string(),
                is_dir: false,
                depth: 0,
                git_status: None,
                is_hidden: false,
            },
        ]);

        assert_eq!(tree.len(), 2);
        assert_eq!(tree[0].path, "src");
        assert_eq!(tree[0].children.len(), 1);
        assert_eq!(tree[0].children[0].path, "src/lib.rs");
        assert_eq!(tree[1].path, "README.md");
    }
}
