use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::{anyhow, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::fs;
use tokio::process::Command;

use crate::app::events::GIT_EVENT;
use crate::projects::models::ProjectRecord;

pub struct GitService {
    app: AppHandle,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeRecord {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffRecord {
    pub path: String,
    pub staged: bool,
    pub diff: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchRecord {
    pub name: String,
    pub reference: String,
    pub commit: String,
    pub upstream: Option<String>,
    pub tracking: Option<String>,
    pub current: bool,
    pub is_remote: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryEntry {
    pub commit: String,
    pub short_commit: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub refs: Vec<String>,
    pub summary: String,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitShowRecord {
    pub commit: String,
    pub diff: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSummary {
    pub branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub staged: usize,
    pub modified: usize,
    pub untracked: usize,
    pub conflicted: usize,
    pub changes: Vec<GitChangeRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitReadiness {
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub author_configured: bool,
    pub commit_message_valid: bool,
    pub message_hint: Option<String>,
    pub blocking_reason: Option<String>,
    pub hooks_path: Option<String>,
    pub active_hooks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitMutationAction {
    Stage,
    Unstage,
    Restore,
    Commit,
    Checkout,
    Fetch,
    Pull,
    Push,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitMutationContext {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_branch: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_point: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub set_upstream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_message: Option<String>,
}

impl GitService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub async fn read_status(&self, project: &ProjectRecord) -> Result<GitStatusSummary> {
        let output = run_git(
            &project.root_path,
            &[
                "status",
                "--porcelain=2",
                "--branch",
                "--untracked-files=all",
            ],
        )
        .await?;
        let summary = parse_status(&output);
        self.app.emit(
            GIT_EVENT,
            serde_json::json!({ "type": "statusRead", "projectId": project.id, "summary": summary }),
        )?;
        Ok(summary)
    }

    pub async fn try_branch_name(&self, project: &ProjectRecord) -> Result<Option<String>> {
        Ok(self.read_status(project).await?.branch)
    }

    pub async fn path_status_map(
        &self,
        project: &ProjectRecord,
    ) -> Result<HashMap<String, String>> {
        let status = self.read_status(project).await?;
        Ok(status
            .changes
            .into_iter()
            .map(|change| (change.path, change.status))
            .collect())
    }

    pub async fn stage_paths(
        &self,
        project: &ProjectRecord,
        paths: &[String],
    ) -> Result<GitStatusSummary> {
        ensure_paths(paths)?;
        let mut args = vec!["add", "--"];
        let path_args = paths.iter().map(String::as_str).collect::<Vec<_>>();
        args.extend(path_args);
        run_git(&project.root_path, &args).await?;
        self.complete_mutation(
            project,
            GitMutationAction::Stage,
            GitMutationContext {
                paths: paths.to_vec(),
                ..GitMutationContext::default()
            },
        )
        .await
    }

    pub async fn unstage_paths(
        &self,
        project: &ProjectRecord,
        paths: &[String],
    ) -> Result<GitStatusSummary> {
        ensure_paths(paths)?;
        let mut args = vec!["restore", "--staged", "--"];
        let path_args = paths.iter().map(String::as_str).collect::<Vec<_>>();
        args.extend(path_args);
        run_git(&project.root_path, &args).await?;
        self.complete_mutation(
            project,
            GitMutationAction::Unstage,
            GitMutationContext {
                paths: paths.to_vec(),
                staged: Some(true),
                ..GitMutationContext::default()
            },
        )
        .await
    }

    pub async fn restore_paths(
        &self,
        project: &ProjectRecord,
        paths: &[String],
        staged: bool,
        worktree: bool,
    ) -> Result<GitStatusSummary> {
        ensure_paths(paths)?;
        if !staged && !worktree {
            return Err(anyhow!(
                "restore must target at least one of staged=true or worktree=true"
            ));
        }
        let mut args = vec!["restore"];
        if staged {
            args.push("--staged");
        }
        if worktree {
            args.push("--worktree");
        }
        args.push("--");
        let path_args = paths.iter().map(String::as_str).collect::<Vec<_>>();
        args.extend(path_args);
        run_git(&project.root_path, &args).await?;
        self.complete_mutation(
            project,
            GitMutationAction::Restore,
            GitMutationContext {
                paths: paths.to_vec(),
                staged: Some(staged),
                worktree: Some(worktree),
                ..GitMutationContext::default()
            },
        )
        .await
    }

    pub async fn commit(&self, project: &ProjectRecord, message: &str) -> Result<GitStatusSummary> {
        let readiness = self.commit_readiness(project, Some(message)).await?;
        if !readiness.commit_message_valid {
            return Err(anyhow!(
                "{}",
                readiness
                    .blocking_reason
                    .unwrap_or_else(|| "commit message is required".to_string())
            ));
        }
        if !readiness.author_configured {
            return Err(anyhow!(
                "{}",
                readiness.blocking_reason.unwrap_or_else(|| {
                    "git author name/email must be configured before commit".to_string()
                })
            ));
        }
        run_git(&project.root_path, &["commit", "-m", message]).await?;
        self.complete_mutation(
            project,
            GitMutationAction::Commit,
            GitMutationContext {
                commit_message: Some(message.to_string()),
                ..GitMutationContext::default()
            },
        )
        .await
    }

    pub async fn commit_readiness(
        &self,
        project: &ProjectRecord,
        message: Option<&str>,
    ) -> Result<GitCommitReadiness> {
        let author_name = git_config_get(&project.root_path, "user.name").await?;
        let author_email = git_config_get(&project.root_path, "user.email").await?;
        let hooks_path = git_path(&project.root_path, "hooks").await?;
        let active_hooks = if let Some(hooks_path) = hooks_path.as_deref() {
            list_active_hooks(&project.root_path, hooks_path).await?
        } else {
            Vec::new()
        };

        let author_configured = author_name.is_some() && author_email.is_some();
        let trimmed = message.map(str::trim).unwrap_or_default();
        let commit_message_valid = !trimmed.is_empty();
        let blocking_reason = if !author_configured {
            Some("git author name/email must be configured before commit".to_string())
        } else if !commit_message_valid {
            Some("commit message cannot be empty".to_string())
        } else {
            None
        };

        Ok(GitCommitReadiness {
            author_name,
            author_email,
            author_configured,
            commit_message_valid,
            message_hint: if commit_message_valid {
                None
            } else {
                Some("Provide a non-empty commit message".to_string())
            },
            blocking_reason,
            hooks_path,
            active_hooks,
        })
    }

    pub async fn list_branches(&self, project: &ProjectRecord) -> Result<Vec<GitBranchRecord>> {
        let output = run_git(
            &project.root_path,
            &[
                "for-each-ref",
                "--format=%(refname:short)\t%(refname)\t%(objectname:short)\t%(upstream:short)\t%(upstream:trackshort)\t%(HEAD)",
                "refs/heads",
                "refs/remotes",
            ],
        )
        .await?;

        let mut branches = output
            .lines()
            .filter_map(parse_branch_line)
            .collect::<Vec<_>>();
        branches.sort_by(|left, right| {
            right
                .current
                .cmp(&left.current)
                .then_with(|| left.is_remote.cmp(&right.is_remote))
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(branches)
    }

    pub async fn checkout_branch(
        &self,
        project: &ProjectRecord,
        branch_name: &str,
        create: bool,
        start_point: Option<&str>,
    ) -> Result<GitStatusSummary> {
        let mut args = vec!["switch"];
        if create {
            args.push("-c");
        }
        args.push(branch_name);
        if let Some(start_point) = start_point {
            args.push(start_point);
        }
        run_git(&project.root_path, &args).await?;
        self.complete_mutation(
            project,
            GitMutationAction::Checkout,
            GitMutationContext {
                branch_name: Some(branch_name.to_string()),
                created_branch: Some(create),
                start_point: start_point.map(str::to_string),
                ..GitMutationContext::default()
            },
        )
        .await
    }

    pub async fn fetch(
        &self,
        project: &ProjectRecord,
        remote: Option<&str>,
    ) -> Result<GitStatusSummary> {
        let mut args = vec!["fetch", "--prune"];
        if let Some(remote) = remote {
            args.push(remote);
        }
        run_git(&project.root_path, &args).await?;
        self.complete_mutation(
            project,
            GitMutationAction::Fetch,
            GitMutationContext {
                remote: remote.map(str::to_string),
                ..GitMutationContext::default()
            },
        )
        .await
    }

    pub async fn pull(
        &self,
        project: &ProjectRecord,
        remote: Option<&str>,
        branch: Option<&str>,
    ) -> Result<GitStatusSummary> {
        let mut args = vec!["pull", "--ff-only"];
        if let Some(remote) = remote {
            args.push(remote);
        }
        if let Some(branch) = branch {
            args.push(branch);
        }
        run_git(&project.root_path, &args).await?;
        self.complete_mutation(
            project,
            GitMutationAction::Pull,
            GitMutationContext {
                remote: remote.map(str::to_string),
                branch: branch.map(str::to_string),
                ..GitMutationContext::default()
            },
        )
        .await
    }

    pub async fn push(
        &self,
        project: &ProjectRecord,
        remote: Option<&str>,
        branch: Option<&str>,
        set_upstream: bool,
    ) -> Result<GitStatusSummary> {
        let mut args = vec!["push"];
        if set_upstream {
            args.push("-u");
        }
        if let Some(remote) = remote {
            args.push(remote);
        }
        if let Some(branch) = branch {
            args.push(branch);
        }
        run_git(&project.root_path, &args).await?;
        self.complete_mutation(
            project,
            GitMutationAction::Push,
            GitMutationContext {
                remote: remote.map(str::to_string),
                branch: branch.map(str::to_string),
                set_upstream: Some(set_upstream),
                ..GitMutationContext::default()
            },
        )
        .await
    }

    pub async fn read_diff(
        &self,
        project: &ProjectRecord,
        path: &str,
        staged: bool,
    ) -> Result<GitDiffRecord> {
        let diff = read_diff_text(&project.root_path, Some(path), staged).await?;
        Ok(GitDiffRecord {
            path: path.to_string(),
            staged,
            diff,
        })
    }

    pub async fn read_diff_tree(
        &self,
        project: &ProjectRecord,
        staged: bool,
    ) -> Result<Vec<GitDiffRecord>> {
        let status = self.read_status(project).await?;
        let paths = status
            .changes
            .iter()
            .filter(|change| change.staged == staged)
            .map(|change| change.path.clone())
            .collect::<Vec<_>>();
        let mut diffs = Vec::new();
        for path in paths {
            let diff = read_diff_text(&project.root_path, Some(&path), staged).await?;
            diffs.push(GitDiffRecord { path, staged, diff });
        }
        Ok(diffs)
    }

    pub async fn read_history(
        &self,
        project: &ProjectRecord,
        limit: usize,
        reference: Option<&str>,
    ) -> Result<Vec<GitHistoryEntry>> {
        let limit = limit.clamp(1, 200);
        let limit_string = limit.to_string();
        let mut args = vec![
            "log",
            "--date=iso-strict",
            "--decorate=short",
            "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1f%b%x1e",
            "-n",
            limit_string.as_str(),
        ];
        if let Some(reference) = reference.filter(|value| !value.trim().is_empty()) {
            args.push(reference);
        }
        let output = run_git(&project.root_path, &args).await?;
        Ok(parse_history(&output))
    }

    pub async fn show_commit(
        &self,
        project: &ProjectRecord,
        commit: &str,
    ) -> Result<GitCommitShowRecord> {
        let diff = run_git(
            &project.root_path,
            &[
                "show",
                "--stat=80",
                "--no-ext-diff",
                "--no-color",
                "--date=iso-strict",
                commit,
            ],
        )
        .await?;
        Ok(GitCommitShowRecord {
            commit: commit.to_string(),
            diff,
        })
    }

    pub fn schedule_status_refresh(app: AppHandle, project_id: String, root_path: String) {
        tokio::spawn(async move {
            if let Ok(summary) = read_status_for_root(&root_path).await {
                let _ = app.emit(
                    GIT_EVENT,
                    serde_json::json!({
                        "type": "statusRead",
                        "projectId": project_id,
                        "summary": summary
                    }),
                );
            }
        });
    }

    async fn complete_mutation(
        &self,
        project: &ProjectRecord,
        action: GitMutationAction,
        context: GitMutationContext,
    ) -> Result<GitStatusSummary> {
        let summary = self.read_status(project).await?;
        self.app.emit(
            GIT_EVENT,
            serde_json::json!({
                "type": "mutationCompleted",
                "projectId": project.id,
                "action": action,
                "context": context,
                "summary": summary
            }),
        )?;
        Ok(summary)
    }
}

fn parse_status(raw: &str) -> GitStatusSummary {
    let mut summary = GitStatusSummary {
        branch: None,
        ahead: 0,
        behind: 0,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicted: 0,
        changes: Vec::new(),
    };

    for line in raw.lines() {
        if let Some(branch) = line.strip_prefix("# branch.head ") {
            if branch != "(detached)" {
                summary.branch = Some(branch.to_string());
            }
            continue;
        }
        if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for token in ab.split_whitespace() {
                if let Some(ahead) = token.strip_prefix('+') {
                    summary.ahead = ahead.parse().unwrap_or(0);
                } else if let Some(behind) = token.strip_prefix('-') {
                    summary.behind = behind.parse().unwrap_or(0);
                }
            }
            continue;
        }
        if line.starts_with("1 ") || line.starts_with("2 ") {
            let mut parts = line.split_whitespace();
            let kind = parts.next().unwrap_or_default();
            let xy = parts.next().unwrap_or_default();
            let path = line
                .split_whitespace()
                .last()
                .unwrap_or_default()
                .to_string();
            let x = xy.chars().next().unwrap_or('.');
            let y = xy.chars().nth(1).unwrap_or('.');
            if x != '.' {
                summary.staged += 1;
            }
            if y != '.' {
                summary.modified += 1;
            }
            let status = match (kind, x, y) {
                (_, 'U', _) | (_, _, 'U') => {
                    summary.conflicted += 1;
                    "conflict"
                }
                ("2", _, _) => "renamed",
                (_, 'A', _) | (_, _, 'A') => "added",
                (_, 'D', _) | (_, _, 'D') => "deleted",
                _ => "modified",
            };
            summary.changes.push(GitChangeRecord {
                path,
                status: status.to_string(),
                staged: x != '.',
            });
        } else if let Some(path) = line.strip_prefix("? ") {
            summary.untracked += 1;
            summary.changes.push(GitChangeRecord {
                path: path.to_string(),
                status: "untracked".to_string(),
                staged: false,
            });
        } else if let Some(rest) = line.strip_prefix("u ") {
            summary.conflicted += 1;
            let path = rest
                .split_whitespace()
                .last()
                .unwrap_or_default()
                .to_string();
            summary.changes.push(GitChangeRecord {
                path,
                status: "conflict".to_string(),
                staged: false,
            });
        }
    }

    summary
}

async fn read_status_for_root(root_path: &str) -> Result<GitStatusSummary> {
    let output = run_git(
        root_path,
        &[
            "status",
            "--porcelain=2",
            "--branch",
            "--untracked-files=all",
        ],
    )
    .await?;
    Ok(parse_status(&output))
}

async fn run_git(root_path: &str, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root_path)
        .args(args)
        .output()
        .await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("git {} failed", args.join(" "))
        };
        return Err(anyhow!(message));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn read_diff_text(root_path: &str, path: Option<&str>, staged: bool) -> Result<String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.push("--no-ext-diff");
    if let Some(path) = path {
        args.push("--");
        args.push(path);
    }
    run_git(root_path, &args).await
}

async fn git_config_get(root_path: &str, key: &str) -> Result<Option<String>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root_path)
        .args(["config", "--get", key])
        .output()
        .await?;
    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if value.is_empty() {
            return Ok(None);
        }
        return Ok(Some(value));
    }
    Ok(None)
}

async fn git_path(root_path: &str, key: &str) -> Result<Option<String>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root_path)
        .args(["rev-parse", "--git-path", key])
        .output()
        .await?;
    if !output.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        return Ok(None);
    }
    Ok(Some(value))
}

async fn list_active_hooks(root_path: &str, hooks_path: &str) -> Result<Vec<String>> {
    let hooks_dir = PathBuf::from(root_path).join(hooks_path);
    let mut entries = match fs::read_dir(&hooks_dir).await {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };
    let mut hooks = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let metadata = entry.metadata().await?;
        if !metadata.is_file() {
            continue;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                continue;
            }
        }
        if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
            hooks.push(name.to_string());
        }
    }
    hooks.sort();
    Ok(hooks)
}

fn ensure_paths(paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Err(anyhow!("at least one path is required"));
    }
    Ok(())
}

fn parse_branch_line(line: &str) -> Option<GitBranchRecord> {
    let mut parts = line.split('\t');
    let name = parts.next()?.to_string();
    let reference = parts.next()?.to_string();
    let commit = parts.next()?.to_string();
    let upstream = normalize_optional(parts.next());
    let tracking = normalize_optional(parts.next());
    let head = parts.next().unwrap_or_default();
    Some(GitBranchRecord {
        name,
        reference: reference.clone(),
        commit,
        upstream,
        tracking,
        current: head == "*",
        is_remote: reference.starts_with("refs/remotes/"),
    })
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    match value.map(str::trim) {
        Some("") | None => None,
        Some(value) => Some(value.to_string()),
    }
}

fn parse_history(raw: &str) -> Vec<GitHistoryEntry> {
    raw.split('\x1e')
        .filter_map(|record| {
            let trimmed = record.trim();
            if trimmed.is_empty() {
                return None;
            }
            let mut fields = trimmed.split('\x1f');
            let commit = fields.next()?.trim().to_string();
            let short_commit = fields.next()?.trim().to_string();
            let author_name = fields.next()?.trim().to_string();
            let author_email = fields.next()?.trim().to_string();
            let authored_at = fields.next()?.trim().to_string();
            let refs = fields
                .next()
                .map(|value| {
                    value
                        .split(',')
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let summary = fields.next()?.trim().to_string();
            let body = fields
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
            Some(GitHistoryEntry {
                commit,
                short_commit,
                author_name,
                author_email,
                authored_at,
                refs,
                summary,
                body,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{ensure_paths, parse_history, parse_status, GitMutationAction, GitMutationContext};

    #[test]
    fn parse_status_counts_staged_and_untracked_changes() {
        let summary = parse_status(
            "# branch.head main\n# branch.ab +2 -1\n1 M. N... 100644 100644 100644 abc def src/main.rs\n? new.txt\n",
        );
        assert_eq!(summary.branch.as_deref(), Some("main"));
        assert_eq!(summary.ahead, 2);
        assert_eq!(summary.behind, 1);
        assert_eq!(summary.staged, 1);
        assert_eq!(summary.untracked, 1);
        assert_eq!(summary.changes.len(), 2);
    }

    #[test]
    fn ensure_paths_requires_non_empty_input() {
        assert!(ensure_paths(&[]).is_err());
        assert!(ensure_paths(&[String::from("src/main.rs")]).is_ok());
    }

    #[test]
    fn git_mutation_context_skips_empty_fields() {
        let value = serde_json::to_value(GitMutationContext::default()).unwrap();
        assert_eq!(value, serde_json::json!({}));
    }

    #[test]
    fn git_mutation_action_serializes_to_camel_case() {
        let value = serde_json::to_value(GitMutationAction::Pull).unwrap();
        assert_eq!(value, serde_json::json!("pull"));
    }

    #[test]
    fn parse_history_reads_commit_records() {
        let history = parse_history(
            "abc123\x1fab12\x1fSaint\x1fsaint@example.com\x1f2026-04-05T10:00:00-04:00\x1fHEAD -> main, origin/main\x1fAdd backend history\x1fDetailed body\x1e",
        );
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].commit, "abc123");
        assert_eq!(history[0].short_commit, "ab12");
        assert_eq!(history[0].refs, vec!["HEAD -> main", "origin/main"]);
        assert_eq!(history[0].summary, "Add backend history");
        assert_eq!(history[0].body.as_deref(), Some("Detailed body"));
    }
}
