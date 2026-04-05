import { create } from 'zustand'
import type { BrowserRuntimeNotice, BrowserTab, ProjectBrowserSidebarItem, ProjectId } from '@/types'

interface BrowserState {
  tabs: Map<string, BrowserTab>
  activeTabId: Map<ProjectId, string | null>
  sidebarItems: Map<ProjectId, ProjectBrowserSidebarItem[]>
  runtimeNotices: Map<string, BrowserRuntimeNotice[]>

  hydrateTabs: (tabs: BrowserTab[]) => void
  hydrateSidebarItems: (projectId: ProjectId, items: ProjectBrowserSidebarItem[]) => void
  upsertTab: (tab: BrowserTab) => void
  closeTab: (tabId: string) => void
  setActiveTab: (projectId: ProjectId, tabId: string) => void
  pushRuntimeNotice: (notice: BrowserRuntimeNotice) => void
  dismissRuntimeNotice: (tabId: string, noticeId: string) => void
}

export const useBrowserStore = create<BrowserState>((set) => ({
  tabs: new Map(),
  activeTabId: new Map(),
  sidebarItems: new Map(),
  runtimeNotices: new Map(),

  hydrateTabs: (tabs) =>
    set((s) => {
      const nextTabs = new Map<string, BrowserTab>()
      const nextActiveTabId = new Map(s.activeTabId)
      for (const tab of tabs) {
        nextTabs.set(tab.id, tab)
      }
      const projectIds = new Set<string>(tabs.map((tab) => tab.projectId))
      for (const projectId of projectIds) {
        const activeId = nextActiveTabId.get(projectId)
        const projectTabs = tabs.filter((tab) => tab.projectId === projectId)
        if (!activeId || !nextTabs.has(activeId)) {
          nextActiveTabId.set(projectId, projectTabs[0]?.id ?? null)
        }
      }
      return { tabs: nextTabs, activeTabId: nextActiveTabId }
    }),

  hydrateSidebarItems: (projectId, items) =>
    set((s) => {
      const sidebarItems = new Map(s.sidebarItems)
      sidebarItems.set(projectId, items)
      return { sidebarItems }
    }),

  upsertTab: (tab) =>
    set((s) => {
      const tabs = new Map(s.tabs)
      tabs.set(tab.id, tab)
      const activeTabId = new Map(s.activeTabId)
      if (!activeTabId.get(tab.projectId)) {
        activeTabId.set(tab.projectId, tab.id)
      }
      return { tabs, activeTabId }
    }),

  closeTab: (tabId) =>
    set((s) => {
      const tabs = new Map(s.tabs)
      const tab = tabs.get(tabId)
      tabs.delete(tabId)
      const runtimeNotices = new Map(s.runtimeNotices)
      runtimeNotices.delete(tabId)
      if (!tab) return { tabs, runtimeNotices }
      const activeTabId = new Map(s.activeTabId)
      if (activeTabId.get(tab.projectId) === tabId) {
        const remaining = [...tabs.values()].filter((candidate) => candidate.projectId === tab.projectId)
        activeTabId.set(tab.projectId, remaining[0]?.id ?? null)
      }
      return { tabs, activeTabId, runtimeNotices }
    }),

  setActiveTab: (projectId, tabId) =>
    set((s) => {
      const activeTabId = new Map(s.activeTabId)
      activeTabId.set(projectId, tabId)
      return { activeTabId }
    }),

  pushRuntimeNotice: (notice) =>
    set((s) => {
      const runtimeNotices = new Map(s.runtimeNotices)
      const existing = runtimeNotices.get(notice.tabId) ?? []
      runtimeNotices.set(notice.tabId, [notice, ...existing].slice(0, 20))
      return { runtimeNotices }
    }),

  dismissRuntimeNotice: (tabId, noticeId) =>
    set((s) => {
      const runtimeNotices = new Map(s.runtimeNotices)
      const existing = runtimeNotices.get(tabId) ?? []
      runtimeNotices.set(
        tabId,
        existing.filter((notice) => notice.id !== noticeId),
      )
      return { runtimeNotices }
    }),
}))
