import { create } from 'zustand'
import type { BrowserRuntimeNotice, BrowserTab, ProjectBrowserSidebarItem, ProjectId } from '@/types'

interface BrowserState {
  tabs: Map<string, BrowserTab>
  activeTabId: Map<ProjectId, string | null>
  sidebarItems: Map<ProjectId, ProjectBrowserSidebarItem[]>
  runtimeNotices: Map<string, BrowserRuntimeNotice[]>
  closedTabIds: Set<string>
  removedProjectIds: Set<ProjectId>

  hydrateTabs: (tabs: BrowserTab[]) => void
  hydrateSidebarItems: (projectId: ProjectId, items: ProjectBrowserSidebarItem[]) => void
  upsertTab: (tab: BrowserTab) => void
  closeTab: (tabId: string) => void
  setActiveTab: (projectId: ProjectId, tabId: string) => void
  pushRuntimeNotice: (notice: BrowserRuntimeNotice) => void
  dismissRuntimeNotice: (tabId: string, noticeId: string) => void
  removeProjectTabs: (projectId: ProjectId) => void
}

export const useBrowserStore = create<BrowserState>((set) => ({
  tabs: new Map(),
  activeTabId: new Map(),
  sidebarItems: new Map(),
  runtimeNotices: new Map(),
  closedTabIds: new Set(),
  removedProjectIds: new Set(),

  hydrateTabs: (tabs) =>
    set((s) => {
      const nextTabs = new Map<string, BrowserTab>()
      const nextActiveTabId = new Map(s.activeTabId)
      const closedTabIds = new Set(s.closedTabIds)
      const tabsByProject = new Map<ProjectId, BrowserTab[]>()
      for (const tab of tabs) {
        if (s.removedProjectIds.has(tab.projectId)) continue
        nextTabs.set(tab.id, tab)
        closedTabIds.delete(tab.id)
        tabsByProject.set(tab.projectId, [...(tabsByProject.get(tab.projectId) ?? []), tab])
      }
      const projectIds = new Set<string>([
        ...tabsByProject.keys(),
        ...nextActiveTabId.keys(),
      ])
      for (const projectId of projectIds) {
        const activeId = nextActiveTabId.get(projectId)
        const projectTabs = tabsByProject.get(projectId) ?? []
        if (projectTabs.length === 0) {
          nextActiveTabId.delete(projectId)
          continue
        }
        if (!activeId || !nextTabs.has(activeId)) {
          nextActiveTabId.set(projectId, projectTabs[0]!.id)
        }
      }
      const runtimeNotices = new Map(s.runtimeNotices)
      for (const tabId of runtimeNotices.keys()) {
        if (!nextTabs.has(tabId)) {
          runtimeNotices.delete(tabId)
        }
      }
      const sidebarItems = new Map(s.sidebarItems)
      for (const [projectId, items] of sidebarItems.entries()) {
        sidebarItems.set(
          projectId,
          items.filter((item) => {
            const tab = nextTabs.get(item.tabId)
            return tab?.projectId === projectId
          }),
        )
      }
      return { tabs: nextTabs, activeTabId: nextActiveTabId, sidebarItems, runtimeNotices, closedTabIds }
    }),

  hydrateSidebarItems: (projectId, items) =>
    set((s) => {
      if (s.removedProjectIds.has(projectId)) return s
      const sidebarItems = new Map(s.sidebarItems)
      sidebarItems.set(
        projectId,
        items.filter((item) => s.tabs.get(item.tabId)?.projectId === projectId),
      )
      return { sidebarItems }
    }),

  upsertTab: (tab) =>
    set((s) => {
      if (s.removedProjectIds.has(tab.projectId) || s.closedTabIds.has(tab.id)) return {}
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
      const closedTabIds = new Set(s.closedTabIds)
      closedTabIds.add(tabId)
      const runtimeNotices = new Map(s.runtimeNotices)
      runtimeNotices.delete(tabId)
      if (!tab) return { tabs, runtimeNotices, closedTabIds }
      const activeTabId = new Map(s.activeTabId)
      if (activeTabId.get(tab.projectId) === tabId) {
        const remaining = [...tabs.values()].filter((candidate) => candidate.projectId === tab.projectId)
        activeTabId.set(tab.projectId, remaining[0]?.id ?? null)
      }
      const sidebarItems = new Map(s.sidebarItems)
      const projectItems = sidebarItems.get(tab.projectId)
      if (projectItems) {
        sidebarItems.set(tab.projectId, projectItems.filter((item) => item.tabId !== tabId))
      }
      return { tabs, activeTabId, sidebarItems, runtimeNotices, closedTabIds }
    }),

  setActiveTab: (projectId, tabId) =>
    set((s) => {
      if (s.removedProjectIds.has(projectId)) return s
      const tab = s.tabs.get(tabId)
      const activeTabId = new Map(s.activeTabId)
      if (!tab || tab.projectId !== projectId) {
        const currentId = activeTabId.get(projectId)
        const currentTab = currentId ? s.tabs.get(currentId) : undefined
        if (currentTab?.projectId === projectId) {
          return {}
        }
        const fallback = [...s.tabs.values()].find((candidate) => candidate.projectId === projectId)
        activeTabId.set(projectId, fallback?.id ?? null)
        return { activeTabId }
      }
      activeTabId.set(projectId, tabId)
      return { activeTabId }
    }),

  pushRuntimeNotice: (notice) =>
    set((s) => {
      if (notice.projectId && s.removedProjectIds.has(notice.projectId)) {
        return {}
      }
      const tab = s.tabs.get(notice.tabId)
      if (!tab || (notice.projectId && tab.projectId !== notice.projectId)) {
        return {}
      }
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

  removeProjectTabs: (projectId) =>
    set((s) => {
      const tabs = new Map(s.tabs)
      const runtimeNotices = new Map(s.runtimeNotices)
      const closedTabIds = new Set(s.closedTabIds)
      for (const tab of tabs.values()) {
        if (tab.projectId === projectId) {
          tabs.delete(tab.id)
          runtimeNotices.delete(tab.id)
          closedTabIds.add(tab.id)
        }
      }
      const activeTabId = new Map(s.activeTabId)
      activeTabId.delete(projectId)
      const sidebarItems = new Map(s.sidebarItems)
      sidebarItems.delete(projectId)
      const removedProjectIds = new Set(s.removedProjectIds)
      removedProjectIds.add(projectId)
      return { tabs, activeTabId, sidebarItems, runtimeNotices, closedTabIds, removedProjectIds }
    }),
}))
