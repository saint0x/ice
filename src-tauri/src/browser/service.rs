use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use parking_lot::RwLock;
use serde::Serialize;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Size, WebviewBuilder,
    WebviewUrl, Window,
};
use uuid::Uuid;

use crate::app::events::BROWSER_EVENT;
use crate::persistence::db::PersistenceService;
use crate::projects::models::ProjectBrowserSidebarItem;

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
    pub window_label: String,
    pub native_webview_label: String,
    pub attached: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserRendererBounds {
    pub tab_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
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
        self.sync_native_host(
            tab_id,
            NativeBrowserAction::Navigate(state.record.url.clone()),
        )?;
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
        self: &Arc<Self>,
        tab_id: &str,
        renderer_id: String,
        pane_id: Option<String>,
        window: Window,
    ) -> Result<BrowserRendererSession> {
        let record = self
            .tabs
            .read()
            .get(tab_id)
            .ok_or_else(|| anyhow!("unknown browser tab"))?
            .record
            .clone();
        if self.renderers.read().contains_key(tab_id) {
            self.detach_renderer(tab_id).await?;
        }
        let native_webview_label = native_webview_label(tab_id, &renderer_id);
        let navigation_service = Arc::clone(self);
        let navigation_tab_id = tab_id.to_string();
        let page_load_service = Arc::clone(self);
        let page_load_tab_id = tab_id.to_string();
        let title_service = Arc::clone(self);
        let title_tab_id = tab_id.to_string();
        let download_service = Arc::clone(self);
        let download_tab_id = tab_id.to_string();
        let new_window_service = Arc::clone(self);
        let new_window_tab_id = tab_id.to_string();
        let builder = WebviewBuilder::new(
            &native_webview_label,
            WebviewUrl::External(parse_browser_url(&record.url)?),
        )
        .initialization_script(browser_runtime_init_script(tab_id))
        .on_navigation(move |url| {
            navigation_service.handle_native_navigation(&navigation_tab_id, url.clone());
            true
        })
        .on_page_load(move |_, payload| {
            page_load_service.handle_native_page_load(
                &page_load_tab_id,
                payload.url().to_string(),
                payload.event() == tauri::webview::PageLoadEvent::Finished,
            );
        })
        .on_document_title_changed(move |_, title| {
            title_service.handle_native_title_changed(&title_tab_id, title);
        })
        .on_download(move |_, event| {
            download_service.handle_native_download(&download_tab_id, event);
            true
        })
        .on_new_window(move |url, _features| {
            new_window_service.handle_native_new_window(&new_window_tab_id, url.to_string());
            tauri::webview::NewWindowResponse::Deny
        });
        window.add_child(
            builder,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(1.0, 1.0),
        )?;
        let session = BrowserRendererSession {
            tab_id: tab_id.to_string(),
            renderer_id,
            pane_id,
            window_label: window.label().to_string(),
            native_webview_label,
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
        if let Some(webview) = self.app.get_webview(&session.native_webview_label) {
            let _ = webview.close();
        }
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "rendererDetached", "session": session }),
        );
        Ok(())
    }

    pub async fn renderer_session(&self, tab_id: &str) -> Option<BrowserRendererSession> {
        self.renderers.read().get(tab_id).cloned()
    }

    pub async fn set_renderer_bounds(
        &self,
        tab_id: &str,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<BrowserRendererBounds> {
        let session = self
            .renderers
            .read()
            .get(tab_id)
            .cloned()
            .ok_or_else(|| anyhow!("no renderer session attached"))?;
        let webview = self
            .app
            .get_webview(&session.native_webview_label)
            .ok_or_else(|| anyhow!("native browser renderer not found"))?;
        webview.set_bounds(Rect {
            position: LogicalPosition::new(x, y).into(),
            size: Size::Logical(LogicalSize::new(width, height)),
        })?;
        webview.show()?;
        Ok(BrowserRendererBounds {
            tab_id: tab_id.to_string(),
            x,
            y,
            width,
            height,
        })
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
        let webview = self
            .app
            .get_webview(&session.native_webview_label)
            .ok_or_else(|| anyhow!("native browser renderer not found"))?;
        let eval_script = format!(
            "window.__ICE_BROWSER__?.findInPage({query}, {forward}, {find_next});",
            query = serde_json::to_string(&query)?,
            forward = if forward { "true" } else { "false" },
            find_next = if find_next { "true" } else { "false" },
        );
        webview.eval(eval_script)?;
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
        let record = self.step_history(tab_id, -1).await?;
        self.sync_native_host(tab_id, NativeBrowserAction::Navigate(record.url.clone()))?;
        Ok(record)
    }

    pub async fn go_forward(&self, tab_id: &str) -> Result<BrowserTabRecord> {
        let record = self.step_history(tab_id, 1).await?;
        self.sync_native_host(tab_id, NativeBrowserAction::Navigate(record.url.clone()))?;
        Ok(record)
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
        self.sync_native_host(tab_id, NativeBrowserAction::Reload)?;
        Ok(record)
    }

    pub async fn close_tab(&self, tab_id: &str) -> Result<()> {
        if self.renderers.read().contains_key(tab_id) {
            self.detach_renderer(tab_id).await?;
        }
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

    pub async fn sidebar_tabs(&self, project_id: &str) -> Vec<ProjectBrowserSidebarItem> {
        let mut items = self
            .tabs
            .read()
            .values()
            .filter(|tab| tab.record.project_id == project_id)
            .map(|tab| ProjectBrowserSidebarItem {
                tab_id: tab.record.tab_id.clone(),
                title: tab.record.title.clone(),
                url: tab.record.url.clone(),
                is_pinned: tab.record.is_pinned,
                is_loading: tab.record.is_loading,
                is_secure: tab.record.is_secure,
            })
            .collect::<Vec<_>>();
        items.sort_by(|left, right| {
            right
                .is_pinned
                .cmp(&left.is_pinned)
                .then_with(|| left.title.cmp(&right.title))
        });
        items
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
            tab.record.is_loading = true;
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

    fn handle_native_navigation(&self, tab_id: &str, url: url::Url) {
        let url_string = url.to_string();
        let updated = self.update_tab(tab_id, |state| {
            if state.record.url != url_string {
                state.history.truncate(state.current_index + 1);
                let position = state.history.len();
                let title = infer_title_from_url(&url_string);
                state.history.push(BrowserHistoryEntry {
                    tab_id: state.record.tab_id.clone(),
                    position,
                    url: url_string.clone(),
                    title: title.clone(),
                });
                state.current_index = position;
                state.record.title = title;
            }
            state.record.url = url_string.clone();
            state.record.is_loading = true;
            state.record.security_origin = browser_security_origin(&url_string);
            state.record.is_secure = is_secure_url(&url_string);
            refresh_record_navigation(state);
        });
        if let Ok(Some(record)) = updated {
            self.persist_current_state(tab_id, record.clone());
            let _ = self.app.emit(
                BROWSER_EVENT,
                serde_json::json!({ "type": "tabNavigated", "tab": record }),
            );
        }
    }

    fn handle_native_page_load(&self, tab_id: &str, url: String, finished: bool) {
        if let Ok(Some(record)) = self.update_tab(tab_id, |state| {
            state.record.url = url.clone();
            state.record.is_loading = !finished;
            state.record.security_origin = browser_security_origin(&url);
            state.record.is_secure = is_secure_url(&url);
            refresh_record_navigation(state);
        }) {
            self.persist_current_state(tab_id, record.clone());
            let _ = self.app.emit(
                BROWSER_EVENT,
                serde_json::json!({ "type": "tabLoadStateChanged", "tab": record }),
            );
        }
    }

    fn handle_native_title_changed(&self, tab_id: &str, title: String) {
        if title.trim().is_empty() {
            return;
        }
        if let Ok(Some(record)) = self.update_tab(tab_id, |state| {
            state.record.title = title.clone();
            if let Some(current) = state.history.get_mut(state.current_index) {
                current.title = title.clone();
            }
        }) {
            self.persist_current_state(tab_id, record.clone());
            let _ = self.app.emit(
                BROWSER_EVENT,
                serde_json::json!({ "type": "tabUpdated", "tab": record }),
            );
        }
    }

    fn handle_native_download(&self, tab_id: &str, event: tauri::webview::DownloadEvent<'_>) {
        if let tauri::webview::DownloadEvent::Requested { url, .. } = event {
            let _ = tauri::async_runtime::block_on(self.request_download(
                tab_id,
                url.to_string(),
                None,
                None,
            ));
        }
    }

    fn handle_native_new_window(&self, tab_id: &str, url: String) {
        let _ = tauri::async_runtime::block_on(self.request_open_external_from_url(tab_id, url));
    }

    async fn request_open_external_from_url(
        &self,
        tab_id: &str,
        url: String,
    ) -> Result<BrowserExternalOpenRequest> {
        let tab = self
            .tabs
            .read()
            .get(tab_id)
            .ok_or_else(|| anyhow!("unknown browser tab"))?
            .record
            .clone();
        let request = BrowserExternalOpenRequest {
            tab_id: tab.tab_id,
            project_id: tab.project_id,
            url,
        };
        let _ = self.app.emit(
            BROWSER_EVENT,
            serde_json::json!({ "type": "openExternalRequested", "request": request.clone() }),
        );
        Ok(request)
    }

    fn persist_current_state(&self, tab_id: &str, record: BrowserTabRecord) {
        let history = self
            .tabs
            .read()
            .get(tab_id)
            .map(|state| state.history.clone())
            .unwrap_or_default();
        let persistence = Arc::clone(&self.persistence);
        let tab_id = tab_id.to_string();
        tauri::async_runtime::spawn(async move {
            let _ = persistence.upsert_browser_tab(record).await;
            let _ = persistence.replace_browser_history(tab_id, history).await;
        });
    }

    fn sync_native_host(&self, tab_id: &str, action: NativeBrowserAction) -> Result<()> {
        let Some(session) = self.renderers.read().get(tab_id).cloned() else {
            return Ok(());
        };
        let webview = self
            .app
            .get_webview(&session.native_webview_label)
            .ok_or_else(|| anyhow!("native browser renderer not found"))?;
        match action {
            NativeBrowserAction::Navigate(url) => webview.navigate(parse_browser_url(&url)?)?,
            NativeBrowserAction::Reload => webview.reload()?,
        }
        Ok(())
    }
}

enum NativeBrowserAction {
    Navigate(String),
    Reload,
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

fn native_webview_label(tab_id: &str, renderer_id: &str) -> String {
    format!(
        "browser-{}-{}",
        sanitize_label(tab_id),
        sanitize_label(renderer_id)
    )
}

fn sanitize_label(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '/' | ':' | '_' => ch,
            _ => '_',
        })
        .collect()
}

fn parse_browser_url(value: &str) -> Result<url::Url> {
    if let Ok(url) = url::Url::parse(value) {
        return Ok(url);
    }
    url::Url::parse(&format!("https://{value}")).map_err(Into::into)
}

fn browser_runtime_init_script(tab_id: &str) -> String {
    let tab_id = serde_json::to_string(tab_id).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r#"
(() => {{
  const TAB_ID = {tab_id};
  const invoke = (command, args) => {{
    try {{
      return window.__TAURI_INTERNALS__.invoke(command, args).catch(() => null);
    }} catch (_) {{
      return Promise.resolve(null);
    }}
  }};

  const absoluteHref = (href) => {{
    if (!href) return null;
    try {{
      return new URL(href, window.location.href).toString();
    }} catch (_) {{
      return null;
    }}
  }};

  const reportMetadata = () => {{
    const icon = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'))
      .map((node) => absoluteHref(node.getAttribute('href')))
      .find(Boolean) ?? null;
    return invoke('browser_tab_renderer_state_set', {{
      input: {{
        tabId: TAB_ID,
        url: window.location.href,
        title: document.title || undefined,
        faviconUrl: icon,
        securityOrigin: window.location.origin || null,
        isSecure: window.location.protocol === 'https:' || window.location.protocol === 'about:' || window.location.protocol === 'tauri:'
      }}
    }});
  }};

  const browserState = {{
    query: '',
    ranges: [],
    activeIndex: -1
  }};

  const selectRange = (range) => {{
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    const element = range.startContainer.parentElement;
    if (element && typeof element.scrollIntoView === 'function') {{
      element.scrollIntoView({{ block: 'center', inline: 'nearest', behavior: 'smooth' }});
    }}
  }};

  const collectRanges = (query) => {{
    if (!document.body || !query) return [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {{
      acceptNode(node) {{
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') {{
          return NodeFilter.FILTER_REJECT;
        }}
        const value = node.nodeValue ?? '';
        return value.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }}
    }});
    const needle = query.toLowerCase();
    const ranges = [];
    while (walker.nextNode()) {{
      const node = walker.currentNode;
      const haystack = (node.nodeValue ?? '').toLowerCase();
      let fromIndex = 0;
      while (fromIndex < haystack.length) {{
        const index = haystack.indexOf(needle, fromIndex);
        if (index === -1) break;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + query.length);
        ranges.push(range);
        fromIndex = index + query.length;
      }}
    }}
    return ranges;
  }};

  const reportFindResult = (query, matches, activeMatchOrdinal) => invoke('browser_find_in_page_report', {{
    input: {{
      tabId: TAB_ID,
      query,
      matches,
      activeMatchOrdinal,
      finalUpdate: true
    }}
  }});

  window.__ICE_BROWSER__ = {{
    reportMetadata,
    findInPage(query, forward = true, findNext = false) {{
      const normalizedQuery = String(query ?? '').trim();
      if (!normalizedQuery) {{
        browserState.query = '';
        browserState.ranges = [];
        browserState.activeIndex = -1;
        return reportFindResult('', 0, 0);
      }}
      if (browserState.query !== normalizedQuery || !findNext) {{
        browserState.query = normalizedQuery;
        browserState.ranges = collectRanges(normalizedQuery);
        browserState.activeIndex = browserState.ranges.length > 0 ? 0 : -1;
      }} else if (browserState.ranges.length > 0) {{
        const delta = forward ? 1 : -1;
        browserState.activeIndex =
          (browserState.activeIndex + delta + browserState.ranges.length) % browserState.ranges.length;
      }}
      if (browserState.activeIndex >= 0 && browserState.ranges[browserState.activeIndex]) {{
        selectRange(browserState.ranges[browserState.activeIndex]);
      }}
      return reportFindResult(
        normalizedQuery,
        browserState.ranges.length,
        browserState.activeIndex >= 0 ? browserState.activeIndex + 1 : 0
      );
    }}
  }};

  const observer = new MutationObserver(() => {{
    void reportMetadata();
  }});
  const watchMetadata = () => {{
    if (document.head) {{
      observer.observe(document.head, {{ childList: true, subtree: true, attributes: true }});
    }}
  }};
  if (document.readyState === 'loading') {{
    document.addEventListener('DOMContentLoaded', () => {{
      watchMetadata();
      void reportMetadata();
    }}, {{ once: true }});
  }} else {{
    watchMetadata();
    void reportMetadata();
  }}
  window.addEventListener('load', () => void reportMetadata());
}})();
"#,
    )
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
