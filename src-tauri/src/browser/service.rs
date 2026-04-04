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
    renderers: RwLock<HashMap<String, BrowserRendererSession>>,
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
    pub is_loading: bool,
    pub favicon_url: Option<String>,
    pub security_origin: Option<String>,
    pub is_secure: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryEntry {
    pub tab_id: String,
    pub position: usize,
    pub url: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserExternalOpenRequest {
    pub tab_id: String,
    pub project_id: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserRendererSession {
    pub tab_id: String,
    pub renderer_id: String,
    pub pane_id: Option<String>,
    pub attached: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFindInPageResult {
    pub tab_id: String,
    pub query: String,
    pub matches: usize,
    pub active_match_ordinal: usize,
    pub final_update: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadRequest {
    pub tab_id: String,
    pub project_id: String,
    pub url: String,
    pub suggested_filename: Option<String>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone)]
struct BrowserTabState {
    record: BrowserTabRecord,
    history: Vec<BrowserHistoryEntry>,
    current_index: usize,
}

#[derive(Debug, Clone, Default)]
pub struct BrowserRendererUpdate {
    pub url: Option<String>,
    pub title: Option<String>,
    pub is_loading: Option<bool>,
    pub favicon_url: Option<Option<String>>,
    pub security_origin: Option<Option<String>>,
    pub is_secure: Option<bool>,
    pub can_go_back: Option<bool>,
    pub can_go_forward: Option<bool>,
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
            renderers: RwLock::new(HashMap::new()),
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
            is_loading: url != "about:blank",
            favicon_url: None,
            security_origin: browser_security_origin(&url),
            is_secure: is_secure_url(&url),
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
            tab.record.url = url.clone();
            tab.record.title = title;
            tab.record.is_loading = true;
            tab.record.security_origin = browser_security_origin(&url);
            tab.record.is_secure = is_secure_url(&url);
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

    pub async fn set_pinned(&self, tab_id: &str, is_pinned: bool) -> Result<BrowserTabRecord> {
        let updated = self
            .update_tab(tab_id, |state| {
                state.record.is_pinned = is_pinned;
            })?
            .ok_or_else(|| anyhow!("unknown browser tab"))?;
        self.persistence.upsert_browser_tab(updated.clone()).await?;
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "tabPinChanged", "tab": updated.clone() }),
        );
        Ok(updated)
    }

    pub async fn sync_renderer_state(
        &self,
        tab_id: &str,
        update: BrowserRendererUpdate,
    ) -> Result<BrowserTabRecord> {
        let updated = self
            .update_tab(tab_id, |state| {
                if let Some(url) = update.url.clone() {
                    state.record.url = url.clone();
                    state.record.security_origin = browser_security_origin(&url);
                    state.record.is_secure = is_secure_url(&url);
                }
                if let Some(title) = update.title.clone() {
                    state.record.title = title.clone();
                    if let Some(current) = state.history.get_mut(state.current_index) {
                        current.title = title;
                    }
                }
                if let Some(is_loading) = update.is_loading {
                    state.record.is_loading = is_loading;
                }
                if let Some(favicon_url) = update.favicon_url.clone() {
                    state.record.favicon_url = favicon_url;
                }
                if let Some(security_origin) = update.security_origin.clone() {
                    state.record.security_origin = security_origin;
                }
                if let Some(is_secure) = update.is_secure {
                    state.record.is_secure = is_secure;
                }
                if let Some(can_go_back) = update.can_go_back {
                    state.record.can_go_back = can_go_back;
                }
                if let Some(can_go_forward) = update.can_go_forward {
                    state.record.can_go_forward = can_go_forward;
                }
            })?
            .ok_or_else(|| anyhow!("unknown browser tab"))?;
        self.persistence.upsert_browser_tab(updated.clone()).await?;
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "tabRendererStateChanged", "tab": updated.clone() }),
        );
        Ok(updated)
    }

    pub async fn request_open_external(&self, tab_id: &str) -> Result<BrowserExternalOpenRequest> {
        let tab = self
            .tabs
            .read()
            .get(tab_id)
            .ok_or_else(|| anyhow!("unknown browser tab"))?
            .record
            .clone();
        let request = BrowserExternalOpenRequest {
            tab_id: tab.tab_id.clone(),
            project_id: tab.project_id.clone(),
            url: tab.url.clone(),
        };
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "openExternalRequested", "request": request.clone() }),
        );
        Ok(request)
    }

    pub async fn attach_renderer(
        &self,
        tab_id: &str,
        renderer_id: String,
        pane_id: Option<String>,
    ) -> Result<BrowserRendererSession> {
        if !self.tabs.read().contains_key(tab_id) {
            return Err(anyhow!("unknown browser tab"));
        }
        let session = BrowserRendererSession {
            tab_id: tab_id.to_string(),
            renderer_id,
            pane_id,
            attached: true,
        };
        self.renderers
            .write()
            .insert(tab_id.to_string(), session.clone());
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "rendererAttached", "session": session.clone() }),
        );
        Ok(session)
    }

    pub async fn detach_renderer(&self, tab_id: &str) -> Result<()> {
        let session = self
            .renderers
            .write()
            .remove(tab_id)
            .ok_or_else(|| anyhow!("no renderer session attached"))?;
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "rendererDetached", "session": session }),
        );
        Ok(())
    }

    pub async fn renderer_session(&self, tab_id: &str) -> Option<BrowserRendererSession> {
        self.renderers.read().get(tab_id).cloned()
    }

    pub async fn request_find_in_page(
        &self,
        tab_id: &str,
        query: String,
        forward: bool,
        find_next: bool,
    ) -> Result<()> {
        let tab = self
            .tabs
            .read()
            .get(tab_id)
            .ok_or_else(|| anyhow!("unknown browser tab"))?
            .record
            .clone();
        let session = self
            .renderers
            .read()
            .get(tab_id)
            .cloned()
            .ok_or_else(|| anyhow!("no renderer session attached"))?;
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({
              "type": "findInPageRequested",
              "tab": tab,
              "session": session,
              "query": query,
              "forward": forward,
              "findNext": find_next
            }),
        );
        Ok(())
    }

    pub async fn report_find_in_page(
        &self,
        tab_id: &str,
        query: String,
        matches: usize,
        active_match_ordinal: usize,
        final_update: bool,
    ) -> Result<BrowserFindInPageResult> {
        if !self.tabs.read().contains_key(tab_id) {
            return Err(anyhow!("unknown browser tab"));
        }
        let result = BrowserFindInPageResult {
            tab_id: tab_id.to_string(),
            query,
            matches,
            active_match_ordinal,
            final_update,
        };
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "findInPageResult", "result": result.clone() }),
        );
        Ok(result)
    }

    pub async fn request_download(
        &self,
        tab_id: &str,
        url: String,
        suggested_filename: Option<String>,
        mime_type: Option<String>,
    ) -> Result<BrowserDownloadRequest> {
        let tab = self
            .tabs
            .read()
            .get(tab_id)
            .ok_or_else(|| anyhow!("unknown browser tab"))?
            .record
            .clone();
        let request = BrowserDownloadRequest {
            tab_id: tab.tab_id,
            project_id: tab.project_id,
            url,
            suggested_filename,
            mime_type,
        };
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "downloadRequested", "request": request.clone() }),
        );
        Ok(request)
    }

    pub async fn go_back(&self, tab_id: &str) -> Result<BrowserTabRecord> {
        self.step_history(tab_id, -1).await
    }

    pub async fn go_forward(&self, tab_id: &str) -> Result<BrowserTabRecord> {
        self.step_history(tab_id, 1).await
    }

    pub async fn reload(&self, tab_id: &str) -> Result<BrowserTabRecord> {
        let record = self
            .update_tab(tab_id, |state| {
                state.record.is_loading = true;
            })?
            .ok_or_else(|| anyhow!("unknown browser tab"))?;
        self.persistence.upsert_browser_tab(record.clone()).await?;
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
        let mut tabs = self
            .tabs
            .read()
            .values()
            .filter(|tab| {
                project_id
                    .map(|id| id == tab.record.project_id)
                    .unwrap_or(true)
            })
            .map(|tab| tab.record.clone())
            .collect::<Vec<_>>();
        tabs.sort_by(|left, right| {
            right
                .is_pinned
                .cmp(&left.is_pinned)
                .then_with(|| left.title.cmp(&right.title))
        });
        tabs
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
        let removed_tab_ids = {
            let tabs = self.tabs.read();
            tabs.values()
                .filter(|tab| tab.record.project_id == project_id)
                .map(|tab| tab.record.tab_id.clone())
                .collect::<Vec<_>>()
        };
        self.tabs
            .write()
            .retain(|_, tab| tab.record.project_id != project_id);
        self.renderers
            .write()
            .retain(|tab_id, _| !removed_tab_ids.iter().any(|id| id == tab_id));
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
            tab.record.url = current.url.clone();
            tab.record.title = current.title;
            tab.record.is_loading = false;
            tab.record.security_origin = browser_security_origin(&current.url);
            tab.record.is_secure = is_secure_url(&current.url);
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

    fn update_tab<F>(&self, tab_id: &str, mut apply: F) -> Result<Option<BrowserTabRecord>>
    where
        F: FnMut(&mut BrowserTabState),
    {
        let updated = {
            let mut tabs = self.tabs.write();
            let Some(state) = tabs.get_mut(tab_id) else {
                return Ok(None);
            };
            apply(state);
            state.record.clone()
        };
        Ok(Some(updated))
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

fn browser_security_origin(url: &str) -> Option<String> {
    let origin = url.split('/').take(3).collect::<Vec<_>>().join("/");
    if origin.contains("://") {
        Some(origin)
    } else {
        None
    }
}

fn is_secure_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("about:") || url.starts_with("tauri://")
}

fn refresh_record_navigation(state: &mut BrowserTabState) {
    state.record.can_go_back = state.current_index > 0;
    state.record.can_go_forward = state.current_index + 1 < state.history.len();
}

#[cfg(test)]
mod tests {
    use super::{browser_security_origin, is_secure_url};

    #[test]
    fn infers_secure_origin_from_https_url() {
        assert_eq!(
            browser_security_origin("https://example.com/docs/page"),
            Some("https://example.com".to_string())
        );
        assert!(is_secure_url("https://example.com"));
        assert!(!is_secure_url("http://example.com"));
    }
}
