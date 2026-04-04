use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::PathBuf;

use crate::browser::service::BrowserTabRecord;
use crate::codex::service::CodexThreadBinding;
use crate::projects::models::ProjectRecord;
use crate::terminal::service::TerminalSessionRecord;

#[derive(Clone)]
pub struct PersistenceService {
    db_path: PathBuf,
}

impl PersistenceService {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let this = Self { db_path };
        this.migrate()?;
        Ok(this)
    }

    fn connect(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.connect()?;
        conn.execute_batch(
            "
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              root_path TEXT NOT NULL UNIQUE,
              color_token TEXT NOT NULL,
              icon_hint TEXT,
              is_trusted INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              last_opened_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workspace_layouts (
              workspace_id TEXT PRIMARY KEY,
              layout_json TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS codex_threads (
              thread_id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              title TEXT,
              model TEXT,
              status TEXT NOT NULL,
              last_turn_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS browser_tabs (
              tab_id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              url TEXT NOT NULL,
              title TEXT NOT NULL,
              is_pinned INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS terminal_sessions (
              session_id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              cwd TEXT NOT NULL,
              shell TEXT NOT NULL,
              title TEXT NOT NULL,
              cols INTEGER NOT NULL,
              rows INTEGER NOT NULL,
              is_running INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_config (
              key TEXT PRIMARY KEY,
              value_json TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            ",
        )?;
        Ok(())
    }

    pub async fn upsert_workspace_layout(&self, workspace_id: String, layout: Value) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "
                INSERT INTO workspace_layouts (workspace_id, layout_json, updated_at)
                VALUES (?1, ?2, datetime('now'))
                ON CONFLICT(workspace_id) DO UPDATE SET
                  layout_json = excluded.layout_json,
                  updated_at = excluded.updated_at
                ",
                params![workspace_id, layout.to_string()],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn read_workspace_layout(&self, workspace_id: &str) -> Result<Option<Value>> {
        let this = self.clone();
        let workspace_id = workspace_id.to_owned();
        tokio::task::spawn_blocking(move || -> Result<Option<Value>> {
            let conn = this.connect()?;
            let raw = conn
                .query_row(
                    "SELECT layout_json FROM workspace_layouts WHERE workspace_id = ?1",
                    params![workspace_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            Ok(raw.map(|text| serde_json::from_str(&text)).transpose()?)
        })
        .await?
    }

    pub fn path(&self) -> &PathBuf {
        &self.db_path
    }

    pub fn load_projects_sync(&self) -> Result<Vec<ProjectRecord>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "
            SELECT id, name, root_path, color_token, icon_hint, is_trusted, created_at, last_opened_at
            FROM projects
            ORDER BY last_opened_at DESC
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ProjectRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                color_token: row.get(3)?,
                icon_hint: row.get(4)?,
                is_trusted: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                last_opened_at: row.get(7)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn insert_project_sync(&self, project: &ProjectRecord) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "
            INSERT INTO projects (id, name, root_path, color_token, icon_hint, is_trusted, created_at, last_opened_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ",
            params![
                project.id,
                project.name,
                project.root_path,
                project.color_token,
                project.icon_hint,
                project.is_trusted as i64,
                project.created_at,
                project.last_opened_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_project_sync(&self, project_id: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
        Ok(())
    }

    pub fn load_codex_threads_sync(&self) -> Result<Vec<CodexThreadBinding>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "
            SELECT project_id, thread_id, title, model, status, last_turn_id
            FROM codex_threads
            ORDER BY updated_at DESC
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(CodexThreadBinding {
                project_id: row.get(0)?,
                thread_id: row.get(1)?,
                title: row.get(2)?,
                model: row.get(3)?,
                status: row.get(4)?,
                last_turn_id: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub async fn upsert_codex_thread(&self, thread: CodexThreadBinding) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "
                INSERT INTO codex_threads (thread_id, project_id, title, model, status, last_turn_id, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now'))
                ON CONFLICT(thread_id) DO UPDATE SET
                  project_id = excluded.project_id,
                  title = excluded.title,
                  model = excluded.model,
                  status = excluded.status,
                  last_turn_id = excluded.last_turn_id,
                  updated_at = excluded.updated_at
                ",
                params![
                    thread.thread_id,
                    thread.project_id,
                    thread.title,
                    thread.model,
                    thread.status,
                    thread.last_turn_id
                ],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn delete_codex_threads_for_project(&self, project_id: String) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "DELETE FROM codex_threads WHERE project_id = ?1",
                params![project_id],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub fn load_browser_tabs_sync(&self) -> Result<Vec<BrowserTabRecord>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "
            SELECT tab_id, project_id, url, title, is_pinned
            FROM browser_tabs
            ORDER BY updated_at DESC
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(BrowserTabRecord {
                tab_id: row.get(0)?,
                project_id: row.get(1)?,
                url: row.get(2)?,
                title: row.get(3)?,
                is_pinned: row.get::<_, i64>(4)? != 0,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub async fn upsert_browser_tab(&self, tab: BrowserTabRecord) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "
                INSERT INTO browser_tabs (tab_id, project_id, url, title, is_pinned, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now'))
                ON CONFLICT(tab_id) DO UPDATE SET
                  project_id = excluded.project_id,
                  url = excluded.url,
                  title = excluded.title,
                  is_pinned = excluded.is_pinned,
                  updated_at = excluded.updated_at
                ",
                params![tab.tab_id, tab.project_id, tab.url, tab.title, tab.is_pinned as i64],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn delete_browser_tab(&self, tab_id: String) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "DELETE FROM browser_tabs WHERE tab_id = ?1",
                params![tab_id],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn delete_browser_tabs_for_project(&self, project_id: String) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "DELETE FROM browser_tabs WHERE project_id = ?1",
                params![project_id],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub fn load_terminal_sessions_sync(&self) -> Result<Vec<TerminalSessionRecord>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "
            SELECT session_id, project_id, cwd, shell, title, cols, rows, is_running
            FROM terminal_sessions
            ORDER BY updated_at DESC
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TerminalSessionRecord {
                session_id: row.get(0)?,
                project_id: row.get(1)?,
                cwd: row.get(2)?,
                shell: row.get(3)?,
                title: row.get(4)?,
                cols: row.get(5)?,
                rows: row.get(6)?,
                is_running: row.get::<_, i64>(7)? != 0,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub async fn upsert_terminal_session(&self, session: TerminalSessionRecord) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "
                INSERT INTO terminal_sessions (session_id, project_id, cwd, shell, title, cols, rows, is_running, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'), datetime('now'))
                ON CONFLICT(session_id) DO UPDATE SET
                  project_id = excluded.project_id,
                  cwd = excluded.cwd,
                  shell = excluded.shell,
                  title = excluded.title,
                  cols = excluded.cols,
                  rows = excluded.rows,
                  is_running = excluded.is_running,
                  updated_at = excluded.updated_at
                ",
                params![
                    session.session_id,
                    session.project_id,
                    session.cwd,
                    session.shell,
                    session.title,
                    session.cols,
                    session.rows,
                    session.is_running as i64
                ],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn delete_terminal_session(&self, session_id: String) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "DELETE FROM terminal_sessions WHERE session_id = ?1",
                params![session_id],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn delete_terminal_sessions_for_project(&self, project_id: String) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "DELETE FROM terminal_sessions WHERE project_id = ?1",
                params![project_id],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn config_set(&self, key: String, value: Value) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "
                INSERT INTO app_config (key, value_json, updated_at)
                VALUES (?1, ?2, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET
                  value_json = excluded.value_json,
                  updated_at = excluded.updated_at
                ",
                params![key, value.to_string()],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn config_get(&self, key: &str) -> Result<Option<Value>> {
        let this = self.clone();
        let key = key.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<Value>> {
            let conn = this.connect()?;
            let raw = conn
                .query_row(
                    "SELECT value_json FROM app_config WHERE key = ?1",
                    params![key],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            Ok(raw.map(|text| serde_json::from_str(&text)).transpose()?)
        })
        .await?
    }
}
