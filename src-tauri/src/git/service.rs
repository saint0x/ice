use std::collections::HashMap;

use anyhow::{anyhow, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
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

impl GitService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub async fn read_status(&self, project: &ProjectRecord) -> Result<GitStatusSummary> {
        let output = Command::new("git")
            .args([
                "-C",
                &project.root_path,
                "status",
                "--porcelain=2",
                "--branch",
                "--untracked-files=all",
            ])
            .output()
            .await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{}",
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            ));
        }
        let summary = parse_status(&String::from_utf8_lossy(&output.stdout));
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

    pub async fn stage_paths(&self, project: &ProjectRecord, paths: &[String]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut command = Command::new("git");
        command
            .arg("-C")
            .arg(&project.root_path)
            .arg("add")
            .arg("--");
        for path in paths {
            command.arg(path);
        }
        let output = command.output().await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{}",
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            ));
        }
        Ok(())
    }

    pub async fn unstage_paths(&self, project: &ProjectRecord, paths: &[String]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut command = Command::new("git");
        command
            .arg("-C")
            .arg(&project.root_path)
            .args(["restore", "--staged", "--"]);
        for path in paths {
            command.arg(path);
        }
        let output = command.output().await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{}",
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            ));
        }
        Ok(())
    }

    pub async fn commit(&self, project: &ProjectRecord, message: &str) -> Result<GitStatusSummary> {
        let output = Command::new("git")
            .arg("-C")
            .arg(&project.root_path)
            .args(["commit", "-m", message])
            .output()
            .await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{}",
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            ));
        }
        self.read_status(project).await
    }

    pub async fn list_branches(&self, project: &ProjectRecord) -> Result<Vec<GitBranchRecord>> {
        let output = Command::new("git")
            .arg("-C")
            .arg(&project.root_path)
            .args([
                "for-each-ref",
                "--format=%(refname:short)\t%(refname)\t%(objectname:short)\t%(upstream:short)\t%(upstream:trackshort)\t%(HEAD)",
                "refs/heads",
                "refs/remotes",
            ])
            .output()
            .await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{}",
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            ));
        }

        let mut branches = String::from_utf8_lossy(&output.stdout)
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
        let mut command = Command::new("git");
        command.arg("-C").arg(&project.root_path).arg("switch");
        if create {
            command.arg("-c");
        }
        command.arg(branch_name);
        if let Some(start_point) = start_point {
            command.arg(start_point);
        }
        let output = command.output().await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{}",
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            ));
        }
        self.read_status(project).await
    }

    pub async fn fetch(
        &self,
        project: &ProjectRecord,
        remote: Option<&str>,
    ) -> Result<GitStatusSummary> {
        let mut command = Command::new("git");
        command
            .arg("-C")
            .arg(&project.root_path)
            .args(["fetch", "--prune"]);
        if let Some(remote) = remote {
            command.arg(remote);
        }
        let output = command.output().await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{}",
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            ));
        }
        self.read_status(project).await
    }

    pub async fn pull(
        &self,
        project: &ProjectRecord,
        remote: Option<&str>,
        branch: Option<&str>,
    ) -> Result<GitStatusSummary> {
        let mut command = Command::new("git");
        command
            .arg("-C")
            .arg(&project.root_path)
            .args(["pull", "--ff-only"]);
        if let Some(remote) = remote {
            command.arg(remote);
        }
        if let Some(branch) = branch {
            command.arg(branch);
        }
        let output = command.output().await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{}",
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            ));
        }
        self.read_status(project).await
    }

    pub async fn push(
        &self,
        project: &ProjectRecord,
        remote: Option<&str>,
        branch: Option<&str>,
        set_upstream: bool,
    ) -> Result<GitStatusSummary> {
        let mut command = Command::new("git");
        command.arg("-C").arg(&project.root_path).arg("push");
        if set_upstream {
            command.arg("-u");
        }
        if let Some(remote) = remote {
            command.arg(remote);
        }
        if let Some(branch) = branch {
            command.arg(branch);
        }
        let output = command.output().await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{}",
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            ));
        }
        self.read_status(project).await
    }

    pub async fn read_diff(
        &self,
        project: &ProjectRecord,
        path: &str,
        staged: bool,
    ) -> Result<GitDiffRecord> {
        let mut command = Command::new("git");
        command.arg("-C").arg(&project.root_path).arg("diff");
        if staged {
            command.arg("--cached");
        }
        command.args(["--no-ext-diff", "--"]);
        command.arg(path);
        let output = command.output().await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{}",
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            ));
        }
        Ok(GitDiffRecord {
            path: path.to_string(),
            staged,
            diff: String::from_utf8_lossy(&output.stdout).to_string(),
        })
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
