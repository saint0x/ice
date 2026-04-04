use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use parking_lot::RwLock;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::app::events::BROWSER_EVENT;
use crate::persistence::db::PersistenceService;

pub struct BrowserService {
    app: AppHandle,
    persistence: Arc<PersistenceService>,
    tabs: RwLock<HashMap<String, BrowserTabState>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabRecord {
    pub tab_id: String,
    pub project_id: String,
    pub url: String,
    pub title: String,
    pub is_pinned: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryEntry {
    pub tab_id: String,
    pub position: usize,
    pub url: String,
    pub title: String,
}

#[derive(Debug, Clone)]
struct BrowserTabState {
    record: BrowserTabRecord,
    history: Vec<BrowserHistoryEntry>,
    current_index: usize,
}

impl BrowserService {
    pub fn new(app: AppHandle, persistence: Arc<PersistenceService>) -> Self {
        let history = persistence
            .load_browser_history_sync()
            .unwrap_or_default()
            .into_iter()
            .fold(
                HashMap::<String, Vec<BrowserHistoryEntry>>::new(),
                |mut acc, entry| {
                    acc.entry(entry.tab_id.clone()).or_default().push(entry);
                    acc
                },
            );
        let tabs = persistence
            .load_browser_tabs_sync()
            .unwrap_or_default()
            .into_iter()
            .map(|tab| {
                let entries = history.get(&tab.tab_id).cloned().unwrap_or_else(|| {
                    vec![BrowserHistoryEntry {
                        tab_id: tab.tab_id.clone(),
                        position: 0,
                        url: tab.url.clone(),
                        title: tab.title.clone(),
                    }]
                });
                let current_index = entries
                    .iter()
                    .position(|entry| entry.url == tab.url && entry.title == tab.title)
                    .unwrap_or(entries.len().saturating_sub(1));
                let mut state = BrowserTabState {
                    record: tab,
                    history: entries,
                    current_index,
                };
                refresh_record_navigation(&mut state);
                (state.record.tab_id.clone(), state)
            })
            .collect();
        Self {
            app,
            persistence,
            tabs: RwLock::new(tabs),
        }
    }

    pub async fn create_tab(
        &self,
        project_id: String,
        url: Option<String>,
        title: Option<String>,
    ) -> Result<BrowserTabRecord> {
        let url = url.unwrap_or_else(|| "about:blank".to_string());
        let title = title.unwrap_or_else(|| "New Tab".to_string());
        let record = BrowserTabRecord {
            tab_id: Uuid::new_v4().to_string(),
            project_id,
            url: url.clone(),
            title: title.clone(),
            is_pinned: false,
            can_go_back: false,
            can_go_forward: false,
        };
        let state = BrowserTabState {
            record: record.clone(),
            history: vec![BrowserHistoryEntry {
                tab_id: record.tab_id.clone(),
                position: 0,
                url,
                title,
            }],
            current_index: 0,
        };
        self.tabs
            .write()
            .insert(record.tab_id.clone(), state.clone());
        self.persistence.upsert_browser_tab(record.clone()).await?;
        self.persistence
            .replace_browser_history(record.tab_id.clone(), state.history)
            .await?;
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "tabCreated", "tab": record.clone() }),
        );
        Ok(record)
    }

    pub async fn navigate_tab(
        &self,
        tab_id: &str,
        url: String,
        title: Option<String>,
    ) -> Result<BrowserTabRecord> {
        let state = {
            let mut tabs = self.tabs.write();
            let tab = tabs
                .get_mut(tab_id)
                .ok_or_else(|| anyhow!("unknown browser tab"))?;
            let title = title.unwrap_or_else(|| infer_title_from_url(&url));
            tab.history.truncate(tab.current_index + 1);
            let position = tab.history.len();
            tab.history.push(BrowserHistoryEntry {
                tab_id: tab.record.tab_id.clone(),
                position,
                url: url.clone(),
                title: title.clone(),
            });
            tab.current_index = position;
            tab.record.url = url;
            tab.record.title = title;
            refresh_record_navigation(tab);
            tab.clone()
        };
        self.persistence
            .upsert_browser_tab(state.record.clone())
            .await?;
        self.persistence
            .replace_browser_history(state.record.tab_id.clone(), state.history)
            .await?;
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "tabNavigated", "tab": state.record.clone() }),
        );
        Ok(state.record)
    }

    pub async fn go_back(&self, tab_id: &str) -> Result<BrowserTabRecord> {
        self.step_history(tab_id, -1).await
    }

    pub async fn go_forward(&self, tab_id: &str) -> Result<BrowserTabRecord> {
        self.step_history(tab_id, 1).await
    }

    pub async fn reload(&self, tab_id: &str) -> Result<BrowserTabRecord> {
        let record = self
            .tabs
            .read()
            .get(tab_id)
            .ok_or_else(|| anyhow!("unknown browser tab"))?
            .record
            .clone();
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "tabReloaded", "tab": record.clone() }),
        );
        Ok(record)
    }

    pub async fn close_tab(&self, tab_id: &str) -> Result<()> {
        self.tabs
            .write()
            .remove(tab_id)
            .ok_or_else(|| anyhow!("unknown browser tab"))?;
        self.persistence
            .delete_browser_tab(tab_id.to_string())
            .await?;
        self.persistence
            .delete_browser_history(tab_id.to_string())
            .await?;
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "tabClosed", "tabId": tab_id }),
        );
        Ok(())
    }

    pub async fn list_tabs(&self, project_id: Option<&str>) -> Vec<BrowserTabRecord> {
        self.tabs
            .read()
            .values()
            .filter(|tab| {
                project_id
                    .map(|id| id == tab.record.project_id)
                    .unwrap_or(true)
            })
            .map(|tab| tab.record.clone())
            .collect()
    }

    pub async fn history(&self, tab_id: &str) -> Result<Vec<BrowserHistoryEntry>> {
        Ok(self
            .tabs
            .read()
            .get(tab_id)
            .ok_or_else(|| anyhow!("unknown browser tab"))?
            .history
            .clone())
    }

    pub async fn remove_project_tabs(&self, project_id: &str) -> Result<()> {
        self.tabs
            .write()
            .retain(|_, tab| tab.record.project_id != project_id);
        self.persistence
            .delete_browser_history_for_project(project_id.to_string())
            .await?;
        self.persistence
            .delete_browser_tabs_for_project(project_id.to_string())
            .await
    }

    async fn step_history(&self, tab_id: &str, delta: isize) -> Result<BrowserTabRecord> {
        let state = {
            let mut tabs = self.tabs.write();
            let tab = tabs
                .get_mut(tab_id)
                .ok_or_else(|| anyhow!("unknown browser tab"))?;
            let target = tab.current_index as isize + delta;
            if target < 0 || target as usize >= tab.history.len() {
                return Err(anyhow!("browser history boundary reached"));
            }
            tab.current_index = target as usize;
            let current = tab.history[tab.current_index].clone();
            tab.record.url = current.url;
            tab.record.title = current.title;
            refresh_record_navigation(tab);
            tab.clone()
        };
        self.persistence
            .upsert_browser_tab(state.record.clone())
            .await?;
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "tabHistoryChanged", "tab": state.record.clone() }),
        );
        Ok(state.record)
    }
}

fn infer_title_from_url(url: &str) -> String {
    url.split("//")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or(url)
        .to_string()
}

fn refresh_record_navigation(state: &mut BrowserTabState) {
    state.record.can_go_back = state.current_index > 0;
    state.record.can_go_forward = state.current_index + 1 < state.history.len();
}
