use anyhow::Result;
use rusqlite::{params, types::Type, Connection, OptionalExtension};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::browser::service::{BrowserHistoryEntry, BrowserTabRecord};
use crate::codex::service::CodexThreadBinding;
use crate::projects::models::ProjectRecord;
use crate::security::approvals::{ApprovalAuditRecord, PendingApprovalRecord};
use crate::terminal::service::TerminalSessionRecord;
use crate::workspace::service::WorkspaceSessionState;

const CURRENT_SCHEMA_VERSION: i64 = 1;

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
            CREATE TABLE IF NOT EXISTS schema_metadata (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            ",
        )?;
        let existing_version = read_schema_version(&conn)?;
        conn.execute_batch(
            "
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
            CREATE TABLE IF NOT EXISTS workspace_sessions (
              workspace_id TEXT PRIMARY KEY,
              session_json TEXT NOT NULL,
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
              is_loading INTEGER NOT NULL DEFAULT 0,
              favicon_url TEXT,
              security_origin TEXT,
              is_secure INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS browser_history (
              tab_id TEXT NOT NULL,
              position INTEGER NOT NULL,
              url TEXT NOT NULL,
              title TEXT NOT NULL,
              visited_at TEXT NOT NULL,
              PRIMARY KEY(tab_id, position)
            );
            CREATE TABLE IF NOT EXISTS terminal_sessions (
              session_id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              cwd TEXT NOT NULL,
              shell TEXT NOT NULL,
              shell_path TEXT NOT NULL DEFAULT '',
              title TEXT NOT NULL,
              cols INTEGER NOT NULL,
              rows INTEGER NOT NULL,
              is_running INTEGER NOT NULL,
              startup_command TEXT,
              env_json TEXT,
              restored_from_persistence INTEGER NOT NULL DEFAULT 0,
              last_exit_code INTEGER,
              last_exit_signal TEXT,
              last_exit_reason TEXT,
              scrollback_bytes INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS terminal_scrollback (
              session_id TEXT PRIMARY KEY,
              content TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_config (
              key TEXT PRIMARY KEY,
              value_json TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS codex_approvals (
              request_id INTEGER PRIMARY KEY,
              project_id TEXT NOT NULL,
              thread_id TEXT,
              action_type TEXT NOT NULL,
              category TEXT NOT NULL DEFAULT 'unknown',
              risk_level TEXT NOT NULL DEFAULT 'medium',
              policy_action TEXT NOT NULL DEFAULT 'prompt',
              policy_reason TEXT,
              description TEXT NOT NULL,
              context_json TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS approval_audit_log (
              audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
              request_id INTEGER NOT NULL,
              project_id TEXT NOT NULL,
              thread_id TEXT,
              action_type TEXT NOT NULL,
              category TEXT NOT NULL,
              risk_level TEXT NOT NULL,
              policy_action TEXT NOT NULL,
              policy_reason TEXT,
              decision TEXT NOT NULL,
              description TEXT NOT NULL,
              context_json TEXT,
              created_at TEXT NOT NULL
            );
            ",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE codex_threads ADD COLUMN last_assistant_message TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE codex_threads ADD COLUMN unread INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE codex_approvals ADD COLUMN category TEXT NOT NULL DEFAULT 'unknown'",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE codex_approvals ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'medium'",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE codex_approvals ADD COLUMN policy_action TEXT NOT NULL DEFAULT 'prompt'",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE codex_approvals ADD COLUMN policy_reason TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE terminal_sessions ADD COLUMN shell_path TEXT NOT NULL DEFAULT ''",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE terminal_sessions ADD COLUMN startup_command TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE terminal_sessions ADD COLUMN env_json TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE terminal_sessions ADD COLUMN restored_from_persistence INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE terminal_sessions ADD COLUMN last_exit_code INTEGER",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE terminal_sessions ADD COLUMN last_exit_signal TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE terminal_sessions ADD COLUMN last_exit_reason TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE terminal_sessions ADD COLUMN scrollback_bytes INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE browser_tabs ADD COLUMN is_loading INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE browser_tabs ADD COLUMN favicon_url TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE browser_tabs ADD COLUMN security_origin TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "ALTER TABLE browser_tabs ADD COLUMN is_secure INTEGER NOT NULL DEFAULT 0",
        )?;
        write_schema_version(&conn, existing_version.unwrap_or(CURRENT_SCHEMA_VERSION))?;
        Ok(())
    }

    #[cfg(test)]
    pub fn schema_version(&self) -> Result<i64> {
        let conn = self.connect()?;
        Ok(read_schema_version(&conn)?.unwrap_or(CURRENT_SCHEMA_VERSION))
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

    pub async fn upsert_workspace_session(
        &self,
        workspace_id: String,
        session: &WorkspaceSessionState,
    ) -> Result<()> {
        let this = self.clone();
        let session_json = serde_json::to_string(session)?;
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "
                INSERT INTO workspace_sessions (workspace_id, session_json, updated_at)
                VALUES (?1, ?2, datetime('now'))
                ON CONFLICT(workspace_id) DO UPDATE SET
                  session_json = excluded.session_json,
                  updated_at = excluded.updated_at
                ",
                params![workspace_id, session_json],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn read_workspace_session(
        &self,
        workspace_id: &str,
    ) -> Result<Option<WorkspaceSessionState>> {
        let this = self.clone();
        let workspace_id = workspace_id.to_owned();
        tokio::task::spawn_blocking(move || -> Result<Option<WorkspaceSessionState>> {
            let conn = this.connect()?;
            let raw = conn
                .query_row(
                    "SELECT session_json FROM workspace_sessions WHERE workspace_id = ?1",
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
            SELECT project_id, thread_id, title, model, status, last_turn_id, last_assistant_message, unread
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
                last_assistant_message: row.get(6)?,
                unread: row.get::<_, i64>(7)? != 0,
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
                INSERT INTO codex_threads (thread_id, project_id, title, model, status, last_turn_id, last_assistant_message, unread, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'), datetime('now'))
                ON CONFLICT(thread_id) DO UPDATE SET
                  project_id = excluded.project_id,
                  title = excluded.title,
                  model = excluded.model,
                  status = excluded.status,
                  last_turn_id = excluded.last_turn_id,
                  last_assistant_message = excluded.last_assistant_message,
                  unread = excluded.unread,
                  updated_at = excluded.updated_at
                ",
                params![
                    thread.thread_id,
                    thread.project_id,
                    thread.title,
                    thread.model,
                    thread.status,
                    thread.last_turn_id,
                    thread.last_assistant_message,
                    thread.unread as i64
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
            SELECT tab_id, project_id, url, title, is_pinned, is_loading, favicon_url, security_origin, is_secure
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
                can_go_back: false,
                can_go_forward: false,
                is_loading: row.get::<_, i64>(5)? != 0,
                favicon_url: row.get(6)?,
                security_origin: row.get(7)?,
                is_secure: row.get::<_, i64>(8)? != 0,
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
                INSERT INTO browser_tabs (tab_id, project_id, url, title, is_pinned, is_loading, favicon_url, security_origin, is_secure, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'), datetime('now'))
                ON CONFLICT(tab_id) DO UPDATE SET
                  project_id = excluded.project_id,
                  url = excluded.url,
                  title = excluded.title,
                  is_pinned = excluded.is_pinned,
                  is_loading = excluded.is_loading,
                  favicon_url = excluded.favicon_url,
                  security_origin = excluded.security_origin,
                  is_secure = excluded.is_secure,
                  updated_at = excluded.updated_at
                ",
                params![
                    tab.tab_id,
                    tab.project_id,
                    tab.url,
                    tab.title,
                    tab.is_pinned as i64,
                    tab.is_loading as i64,
                    tab.favicon_url,
                    tab.security_origin,
                    tab.is_secure as i64
                ],
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

    pub fn load_browser_history_sync(&self) -> Result<Vec<BrowserHistoryEntry>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "
            SELECT tab_id, position, url, title
            FROM browser_history
            ORDER BY tab_id ASC, position ASC
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(BrowserHistoryEntry {
                tab_id: row.get(0)?,
                position: row.get(1)?,
                url: row.get(2)?,
                title: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub async fn replace_browser_history(
        &self,
        tab_id: String,
        history: Vec<BrowserHistoryEntry>,
    ) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let mut conn = this.connect()?;
            let tx = conn.transaction()?;
            tx.execute(
                "DELETE FROM browser_history WHERE tab_id = ?1",
                params![tab_id],
            )?;
            for entry in history {
                tx.execute(
                    "
                    INSERT INTO browser_history (tab_id, position, url, title, visited_at)
                    VALUES (?1, ?2, ?3, ?4, datetime('now'))
                    ",
                    params![entry.tab_id, entry.position, entry.url, entry.title],
                )?;
            }
            tx.commit()?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn delete_browser_history(&self, tab_id: String) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "DELETE FROM browser_history WHERE tab_id = ?1",
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

    pub async fn delete_browser_history_for_project(&self, project_id: String) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "
                DELETE FROM browser_history
                WHERE tab_id IN (SELECT tab_id FROM browser_tabs WHERE project_id = ?1)
                ",
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
            SELECT
              session_id,
              project_id,
              cwd,
              shell,
              COALESCE(NULLIF(shell_path, ''), shell),
              title,
              cols,
              rows,
              is_running,
              startup_command,
              env_json,
              restored_from_persistence,
              last_exit_code,
              last_exit_signal,
              last_exit_reason,
              scrollback_bytes
            FROM terminal_sessions
            ORDER BY updated_at DESC
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            let env_json: Option<String> = row.get(10)?;
            Ok(TerminalSessionRecord {
                session_id: row.get(0)?,
                project_id: row.get(1)?,
                cwd: row.get(2)?,
                shell: row.get(3)?,
                shell_path: row.get(4)?,
                title: row.get(5)?,
                cols: row.get(6)?,
                rows: row.get(7)?,
                is_running: row.get::<_, i64>(8)? != 0,
                startup_command: row.get(9)?,
                env_overrides: env_json
                    .map(|value| serde_json::from_str(&value))
                    .transpose()
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(10, Type::Text, Box::new(error))
                    })?,
                restored_from_persistence: row.get::<_, i64>(11)? != 0,
                last_exit_code: row.get(12)?,
                last_exit_signal: row.get(13)?,
                last_exit_reason: row.get(14)?,
                scrollback_bytes: row.get::<_, i64>(15)? as usize,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn upsert_terminal_session_sync(&self, session: &TerminalSessionRecord) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "
            INSERT INTO terminal_sessions (
              session_id, project_id, cwd, shell, shell_path, title, cols, rows, is_running,
              startup_command, env_json, restored_from_persistence, last_exit_code,
              last_exit_signal, last_exit_reason, scrollback_bytes, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, datetime('now'), datetime('now'))
            ON CONFLICT(session_id) DO UPDATE SET
              project_id = excluded.project_id,
              cwd = excluded.cwd,
              shell = excluded.shell,
              shell_path = excluded.shell_path,
              title = excluded.title,
              cols = excluded.cols,
              rows = excluded.rows,
              is_running = excluded.is_running,
              startup_command = excluded.startup_command,
              env_json = excluded.env_json,
              restored_from_persistence = excluded.restored_from_persistence,
              last_exit_code = excluded.last_exit_code,
              last_exit_signal = excluded.last_exit_signal,
              last_exit_reason = excluded.last_exit_reason,
              scrollback_bytes = excluded.scrollback_bytes,
              updated_at = excluded.updated_at
            ",
            params![
                session.session_id,
                session.project_id,
                session.cwd,
                session.shell,
                session.shell_path,
                session.title,
                session.cols,
                session.rows,
                session.is_running as i64,
                session.startup_command,
                session
                    .env_overrides
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
                session.restored_from_persistence as i64,
                session.last_exit_code,
                session.last_exit_signal,
                session.last_exit_reason,
                session.scrollback_bytes as i64
            ],
        )?;
        Ok(())
    }

    pub async fn upsert_terminal_session(&self, session: TerminalSessionRecord) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            this.upsert_terminal_session_sync(&session)
        })
        .await??;
        Ok(())
    }

    pub fn load_terminal_scrollback_sync(&self) -> Result<HashMap<String, String>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "
            SELECT session_id, content
            FROM terminal_scrollback
            ORDER BY updated_at DESC
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        Ok(rows.collect::<rusqlite::Result<HashMap<_, _>>>()?)
    }

    pub async fn upsert_terminal_scrollback(
        &self,
        session_id: String,
        content: String,
    ) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "
                INSERT INTO terminal_scrollback (session_id, content, updated_at)
                VALUES (?1, ?2, datetime('now'))
                ON CONFLICT(session_id) DO UPDATE SET
                  content = excluded.content,
                  updated_at = excluded.updated_at
                ",
                params![session_id, content],
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

    pub async fn delete_terminal_scrollback(&self, session_id: String) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "DELETE FROM terminal_scrollback WHERE session_id = ?1",
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

    pub async fn delete_terminal_scrollback_for_project(&self, project_id: String) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "
                DELETE FROM terminal_scrollback
                WHERE session_id IN (SELECT session_id FROM terminal_sessions WHERE project_id = ?1)
                ",
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

    pub fn load_pending_approvals_sync(&self) -> Result<Vec<PendingApprovalRecord>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "
            SELECT request_id, project_id, thread_id, action_type, category, risk_level, policy_action, policy_reason, description, context_json
            FROM codex_approvals
            ORDER BY created_at ASC
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            let raw_context: Option<String> = row.get(9)?;
            let context_json = raw_context
                .map(|text| {
                    serde_json::from_str(&text).map_err(|err| {
                        rusqlite::Error::FromSqlConversionFailure(9, Type::Text, Box::new(err))
                    })
                })
                .transpose()?;
            Ok(PendingApprovalRecord {
                request_id: row.get(0)?,
                project_id: row.get(1)?,
                thread_id: row.get(2)?,
                action_type: row.get(3)?,
                category: row.get(4)?,
                risk_level: row.get(5)?,
                policy_action: row.get(6)?,
                policy_reason: row.get(7)?,
                description: row.get(8)?,
                context_json,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub async fn upsert_pending_approval(&self, approval: PendingApprovalRecord) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "
                INSERT INTO codex_approvals (request_id, project_id, thread_id, action_type, category, risk_level, policy_action, policy_reason, description, context_json, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'), datetime('now'))
                ON CONFLICT(request_id) DO UPDATE SET
                  project_id = excluded.project_id,
                  thread_id = excluded.thread_id,
                  action_type = excluded.action_type,
                  category = excluded.category,
                  risk_level = excluded.risk_level,
                  policy_action = excluded.policy_action,
                  policy_reason = excluded.policy_reason,
                  description = excluded.description,
                  context_json = excluded.context_json,
                  updated_at = excluded.updated_at
                ",
                params![
                    approval.request_id,
                    approval.project_id,
                    approval.thread_id,
                    approval.action_type,
                    approval.category,
                    approval.risk_level,
                    approval.policy_action,
                    approval.policy_reason,
                    approval.description,
                    approval.context_json.map(|value| value.to_string())
                ],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn delete_pending_approval(&self, request_id: u64) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "DELETE FROM codex_approvals WHERE request_id = ?1",
                params![request_id],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn delete_pending_approvals_for_project(&self, project_id: String) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = this.connect()?;
            conn.execute(
                "DELETE FROM codex_approvals WHERE project_id = ?1",
                params![project_id],
            )?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    pub async fn append_approval_audit(
        &self,
        approval: PendingApprovalRecord,
        decision: String,
    ) -> Result<ApprovalAuditRecord> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<ApprovalAuditRecord> {
            let conn = this.connect()?;
            let created_at = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "
                INSERT INTO approval_audit_log (
                  request_id, project_id, thread_id, action_type, category, risk_level, policy_action, policy_reason, decision, description, context_json, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ",
                params![
                    approval.request_id,
                    approval.project_id,
                    approval.thread_id,
                    approval.action_type,
                    approval.category,
                    approval.risk_level,
                    approval.policy_action,
                    approval.policy_reason,
                    decision,
                    approval.description,
                    approval.context_json.clone().map(|value| value.to_string()),
                    created_at,
                ],
            )?;
            Ok(ApprovalAuditRecord {
                audit_id: conn.last_insert_rowid(),
                request_id: approval.request_id,
                project_id: approval.project_id,
                thread_id: approval.thread_id,
                action_type: approval.action_type,
                category: approval.category,
                risk_level: approval.risk_level,
                policy_action: approval.policy_action,
                policy_reason: approval.policy_reason,
                decision,
                description: approval.description,
                context_json: approval.context_json,
                created_at,
            })
        })
        .await?
    }

    pub async fn load_approval_audit_log(
        &self,
        project_id: Option<&str>,
    ) -> Result<Vec<ApprovalAuditRecord>> {
        let this = self.clone();
        let project_id = project_id.map(ToOwned::to_owned);
        tokio::task::spawn_blocking(move || -> Result<Vec<ApprovalAuditRecord>> {
            let conn = this.connect()?;
            let mut stmt = if project_id.is_some() {
                conn.prepare(
                    "
                    SELECT audit_id, request_id, project_id, thread_id, action_type, category, risk_level, policy_action, policy_reason, decision, description, context_json, created_at
                    FROM approval_audit_log
                    WHERE project_id = ?1
                    ORDER BY audit_id DESC
                    ",
                )?
            } else {
                conn.prepare(
                    "
                    SELECT audit_id, request_id, project_id, thread_id, action_type, category, risk_level, policy_action, policy_reason, decision, description, context_json, created_at
                    FROM approval_audit_log
                    ORDER BY audit_id DESC
                    ",
                )?
            };
            let rows = if let Some(project_id) = project_id {
                stmt.query_map(params![project_id], approval_audit_row)?
            } else {
                stmt.query_map([], approval_audit_row)?
            };
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
        .await?
    }
}

fn approval_audit_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ApprovalAuditRecord> {
    let raw_context: Option<String> = row.get(11)?;
    let context_json = raw_context
        .map(|text| {
            serde_json::from_str(&text).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(11, Type::Text, Box::new(err))
            })
        })
        .transpose()?;
    Ok(ApprovalAuditRecord {
        audit_id: row.get(0)?,
        request_id: row.get(1)?,
        project_id: row.get(2)?,
        thread_id: row.get(3)?,
        action_type: row.get(4)?,
        category: row.get(5)?,
        risk_level: row.get(6)?,
        policy_action: row.get(7)?,
        policy_reason: row.get(8)?,
        decision: row.get(9)?,
        description: row.get(10)?,
        context_json,
        created_at: row.get(12)?,
    })
}

fn add_column_if_missing(conn: &Connection, sql: &str) -> Result<()> {
    match conn.execute(sql, []) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(_, Some(message)))
            if message.contains("duplicate column name") =>
        {
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

fn read_schema_version(conn: &Connection) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT value FROM schema_metadata WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|value| value.parse::<i64>())
        .transpose()?)
}

fn write_schema_version(conn: &Connection, version: i64) -> Result<()> {
    conn.execute(
        "
        INSERT INTO schema_metadata (key, value, updated_at)
        VALUES ('schema_version', ?1, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        ",
        params![version.to_string()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{PersistenceService, CURRENT_SCHEMA_VERSION};
    use crate::browser::service::{BrowserHistoryEntry, BrowserTabRecord};
    use crate::codex::service::CodexThreadBinding;
    use crate::security::approvals::PendingApprovalRecord;
    use crate::terminal::service::TerminalSessionRecord;
    use crate::workspace::service::{
        WorkspacePaneNode, WorkspaceSessionState, WorkspaceSplitNode, WorkspaceTabRecord,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use tempfile::tempdir;

    #[tokio::test]
    async fn persists_workspace_browser_terminal_codex_and_config_state() {
        let temp = tempdir().expect("temp dir");
        let db = PersistenceService::new(temp.path().join("ice.db")).expect("db");

        db.upsert_workspace_layout("workspace-a".to_string(), json!({"panes": 3}))
            .await
            .expect("workspace write");
        assert_eq!(
            db.read_workspace_layout("workspace-a")
                .await
                .expect("workspace read"),
            Some(json!({"panes": 3}))
        );

        let workspace_session = WorkspaceSessionState {
            active_pane_id: "pane-1".to_string(),
            tabs: vec![WorkspaceTabRecord {
                id: "tab-1".to_string(),
                project_id: "project-a".to_string(),
                kind: "editor".to_string(),
                title: "main.rs".to_string(),
                icon: Some("file-code".to_string()),
                dirty: true,
                pinned: false,
                meta: Some(json!({"path":"src/main.rs"})),
            }],
            root: WorkspacePaneNode::Split(WorkspaceSplitNode {
                id: "split-1".to_string(),
                direction: "horizontal".to_string(),
                children: vec![
                    WorkspacePaneNode::Leaf {
                        id: "pane-1".to_string(),
                        tabs: vec!["tab-1".to_string()],
                        active_tab_id: Some("tab-1".to_string()),
                    },
                    WorkspacePaneNode::Leaf {
                        id: "pane-2".to_string(),
                        tabs: Vec::new(),
                        active_tab_id: None,
                    },
                ],
                ratio: 0.5,
            }),
        };
        db.upsert_workspace_session("workspace-a".to_string(), &workspace_session)
            .await
            .expect("workspace session write");
        assert_eq!(
            db.read_workspace_session("workspace-a")
                .await
                .expect("workspace session read"),
            Some(workspace_session)
        );

        let tab = BrowserTabRecord {
            tab_id: "tab-1".to_string(),
            project_id: "project-a".to_string(),
            url: "https://example.com".to_string(),
            title: "Example".to_string(),
            is_pinned: true,
            can_go_back: false,
            can_go_forward: false,
            is_loading: false,
            favicon_url: Some("https://example.com/favicon.ico".to_string()),
            security_origin: Some("https://example.com".to_string()),
            is_secure: true,
        };
        db.upsert_browser_tab(tab.clone())
            .await
            .expect("browser write");
        db.replace_browser_history(
            "tab-1".to_string(),
            vec![BrowserHistoryEntry {
                tab_id: "tab-1".to_string(),
                position: 0,
                url: "https://example.com".to_string(),
                title: "Example".to_string(),
            }],
        )
        .await
        .expect("browser history write");
        assert_eq!(
            db.load_browser_tabs_sync().expect("browser read"),
            vec![tab]
        );
        assert_eq!(
            db.load_browser_history_sync().expect("history read").len(),
            1
        );

        let session = TerminalSessionRecord {
            session_id: "term-1".to_string(),
            project_id: "project-a".to_string(),
            cwd: "/tmp/project-a".to_string(),
            shell: "zsh".to_string(),
            shell_path: "/bin/zsh".to_string(),
            title: "Terminal".to_string(),
            cols: 120,
            rows: 40,
            is_running: false,
            startup_command: Some("pnpm dev".to_string()),
            env_overrides: Some(HashMap::from([(
                "NODE_ENV".to_string(),
                "development".to_string(),
            )])),
            restored_from_persistence: true,
            last_exit_code: Some(0),
            last_exit_signal: None,
            last_exit_reason: Some("process_exit".to_string()),
            scrollback_bytes: 11,
        };
        db.upsert_terminal_session(session.clone())
            .await
            .expect("terminal write");
        db.upsert_terminal_scrollback("term-1".to_string(), "hello world".to_string())
            .await
            .expect("terminal scrollback write");
        assert_eq!(
            db.load_terminal_sessions_sync().expect("terminal read"),
            vec![session]
        );
        assert_eq!(
            db.load_terminal_scrollback_sync()
                .expect("terminal scrollback read")
                .get("term-1"),
            Some(&"hello world".to_string())
        );

        let thread = CodexThreadBinding {
            project_id: "project-a".to_string(),
            thread_id: "thread-1".to_string(),
            title: Some("Agent".to_string()),
            model: Some("gpt-5-codex".to_string()),
            status: "idle".to_string(),
            last_turn_id: Some("turn-1".to_string()),
            last_assistant_message: Some("Summary".to_string()),
            unread: true,
        };
        db.upsert_codex_thread(thread.clone())
            .await
            .expect("codex write");
        assert_eq!(
            db.load_codex_threads_sync().expect("codex read"),
            vec![thread]
        );

        db.config_set("storage.root".to_string(), json!("/tmp/.ice"))
            .await
            .expect("config write");
        assert_eq!(
            db.config_get("storage.root").await.expect("config read"),
            Some(json!("/tmp/.ice"))
        );

        let approval = PendingApprovalRecord {
            request_id: 7,
            project_id: "project-a".to_string(),
            thread_id: Some("thread-1".to_string()),
            action_type: "approval/request".to_string(),
            category: "filesystem".to_string(),
            risk_level: "medium".to_string(),
            policy_action: "prompt".to_string(),
            policy_reason: Some(
                "High-risk filesystem mutation requires explicit approval".to_string(),
            ),
            description: "Allow file edit".to_string(),
            context_json: Some(json!({"path":"src/main.rs"})),
        };
        db.upsert_pending_approval(approval.clone())
            .await
            .expect("approval write");
        assert_eq!(
            db.load_pending_approvals_sync().expect("approval read"),
            vec![approval.clone()]
        );
        let approval_audit = db
            .append_approval_audit(approval.clone(), "approved".to_string())
            .await
            .expect("approval audit write");
        assert_eq!(approval_audit.decision, "approved");
        assert_eq!(
            db.load_approval_audit_log(Some("project-a"))
                .await
                .expect("approval audit read")
                .len(),
            1
        );

        db.delete_browser_tabs_for_project("project-a".to_string())
            .await
            .expect("browser delete");
        db.delete_browser_history_for_project("project-a".to_string())
            .await
            .expect("browser history delete");
        db.delete_terminal_sessions_for_project("project-a".to_string())
            .await
            .expect("terminal delete");
        db.delete_codex_threads_for_project("project-a".to_string())
            .await
            .expect("codex delete");
        db.delete_pending_approvals_for_project("project-a".to_string())
            .await
            .expect("approval delete");

        assert!(db
            .load_browser_tabs_sync()
            .expect("browser empty")
            .is_empty());
        assert!(db
            .load_terminal_sessions_sync()
            .expect("terminal empty")
            .is_empty());
        assert!(db
            .load_codex_threads_sync()
            .expect("codex empty")
            .is_empty());
        assert!(db
            .load_pending_approvals_sync()
            .expect("approval empty")
            .is_empty());
    }

    #[test]
    fn persists_canonical_schema_version() {
        let temp = tempdir().expect("temp dir");
        let db = PersistenceService::new(temp.path().join("ice.db")).expect("db");
        assert_eq!(
            db.schema_version().expect("schema version"),
            CURRENT_SCHEMA_VERSION
        );
    }
}
