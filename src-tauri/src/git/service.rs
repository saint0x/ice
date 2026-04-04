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
pub struct GitStatusSummary {
    pub branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub staged: usize,
    pub modified: usize,
    pub untracked: usize,
    pub conflicted: usize,
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
            let xy = line.split_whitespace().nth(1).unwrap_or("");
            let x = xy.chars().next().unwrap_or('.');
            let y = xy.chars().nth(1).unwrap_or('.');
            if x != '.' {
                summary.staged += 1;
            }
            if y != '.' {
                summary.modified += 1;
            }
        } else if line.starts_with("? ") {
            summary.untracked += 1;
        } else if line.starts_with("u ") {
            summary.conflicted += 1;
        }
    }

    summary
}
