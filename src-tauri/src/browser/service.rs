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
    tabs: RwLock<HashMap<String, BrowserTabRecord>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabRecord {
    pub tab_id: String,
    pub project_id: String,
    pub url: String,
    pub title: String,
    pub is_pinned: bool,
}

impl BrowserService {
    pub fn new(app: AppHandle, persistence: Arc<PersistenceService>) -> Self {
        let tabs = persistence
            .load_browser_tabs_sync()
            .unwrap_or_default()
            .into_iter()
            .map(|tab| (tab.tab_id.clone(), tab))
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
        let record = BrowserTabRecord {
            tab_id: Uuid::new_v4().to_string(),
            project_id,
            url: url.unwrap_or_else(|| "about:blank".to_string()),
            title: title.unwrap_or_else(|| "New Tab".to_string()),
            is_pinned: false,
        };
        self.tabs
            .write()
            .insert(record.tab_id.clone(), record.clone());
        self.persistence.upsert_browser_tab(record.clone()).await?;
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
        let record = {
            let mut tabs = self.tabs.write();
            let tab = tabs
                .get_mut(tab_id)
                .ok_or_else(|| anyhow!("unknown browser tab"))?;
            tab.url = url;
            if let Some(title) = title {
                tab.title = title;
            }
            tab.clone()
        };
        self.persistence.upsert_browser_tab(record.clone()).await?;
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "tabNavigated", "tab": record.clone() }),
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
            .filter(|tab| project_id.map(|id| id == tab.project_id).unwrap_or(true))
            .cloned()
            .collect()
    }

    pub async fn remove_project_tabs(&self, project_id: &str) -> Result<()> {
        self.tabs
            .write()
            .retain(|_, tab| tab.project_id != project_id);
        self.persistence
            .delete_browser_tabs_for_project(project_id.to_string())
            .await
    }
}
