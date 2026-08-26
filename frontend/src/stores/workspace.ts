import { create } from 'zustand'
import type { PaneLayout, PaneNode, PaneSplit, PaneId, TabId, Tab, ContentType, ProjectId, SplitDirection } from '@/types'

let _paneCounter = 0
let _tabCounter = 0
const nextPaneId = (): PaneId => `pane-${++_paneCounter}`
const nextTabId = (): TabId => `tab-${++_tabCounter}`
const clampSidebarWidth = (width: number) => Math.max(180, Math.min(400, width))
const clampBottomDockHeight = (height: number) => Math.max(100, Math.min(600, height))
const clampChatPanelWidth = (width: number) => Math.max(280, Math.min(520, width))
const clampSplitRatio = (ratio: number) => Math.max(0.15, Math.min(0.85, Number.isFinite(ratio) ? ratio : 0.5))

interface WorkspaceState {
  layout: PaneLayout
  tabs: Map<TabId, Tab>
  activePaneId: PaneId
  pendingFocusPaneId: PaneId | null
  sidebarOpen: boolean
  sidebarWidth: number
  bottomDockOpen: boolean
  bottomDockHeight: number
  chatPanelOpen: boolean
  chatPanelWidth: number

  hydrateWorkspace: (input: {
    layout: PaneLayout
    tabs: Tab[]
    activePaneId: PaneId
    sidebarOpen: boolean
    sidebarWidth: number
    bottomDockOpen: boolean
    bottomDockHeight: number
    chatPanelOpen: boolean
    chatPanelWidth: number
  }) => void
  openTab: (paneId: PaneId, type: ContentType, title: string, projectId: ProjectId, meta?: Record<string, unknown>) => TabId
  updateTab: (tabId: TabId, patch: Partial<Tab>) => void
  closeTab: (paneId: PaneId, tabId: TabId) => void
  activateTab: (paneId: PaneId, tabId: TabId) => void
  setActivePane: (paneId: PaneId) => void
  clearPendingFocusPane: (paneId: PaneId) => void
  splitPane: (paneId: PaneId, direction: SplitDirection) => void
  setSidebarOpen: (open: boolean) => void
  setSidebarWidth: (width: number) => void
  setBottomDockOpen: (open: boolean) => void
  setBottomDockHeight: (height: number) => void
  setChatPanelOpen: (open: boolean) => void
  setChatPanelWidth: (width: number) => void
  updateSplitRatio: (splitId: string, ratio: number) => void
}

const initialPaneId = nextPaneId()
const initialLayout: PaneNode = {
  id: initialPaneId,
  type: 'leaf',
  tabs: [],
  activeTabId: null,
}

function findAndUpdatePane(layout: PaneLayout, paneId: PaneId, updater: (pane: PaneNode) => PaneNode): PaneLayout {
  if (layout.type === 'leaf') {
    return layout.id === paneId ? updater(layout) : layout
  }
  return {
    ...layout,
    children: layout.children.map((child) => findAndUpdatePane(child, paneId, updater)),
  }
}

function findAndReplace(layout: PaneLayout, paneId: PaneId, replacer: (pane: PaneNode) => PaneLayout): PaneLayout {
  if (layout.type === 'leaf') {
    return layout.id === paneId ? replacer(layout) : layout
  }
  return {
    ...layout,
    children: layout.children.map((child) => findAndReplace(child, paneId, replacer)),
  }
}

function collectPaneIds(layout: PaneLayout): PaneId[] {
  if (layout.type === 'leaf') return [layout.id]
  return layout.children.flatMap(collectPaneIds)
}

function findFirstPaneId(layout: PaneLayout): PaneId {
  if (layout.type === 'leaf') return layout.id
  const firstChild = layout.children[0]
  return firstChild ? findFirstPaneId(firstChild) : layout.id
}

function layoutHasPane(layout: PaneLayout, paneId: PaneId): boolean {
  if (layout.type === 'leaf') return layout.id === paneId
  return layout.children.some((child) => layoutHasPane(child, paneId))
}

function paneHasTab(layout: PaneLayout, paneId: PaneId, tabId: TabId): boolean {
  if (layout.type === 'leaf') {
    return layout.id === paneId && layout.tabs.includes(tabId)
  }
  return layout.children.some((child) => paneHasTab(child, paneId, tabId))
}

function collectLayoutTabIds(layout: PaneLayout): TabId[] {
  if (layout.type === 'leaf') return layout.tabs
  return layout.children.flatMap(collectLayoutTabIds)
}

function syncCountersFromWorkspace(layout: PaneLayout, tabs: Tab[]) {
  const paneIds = collectPaneIds(layout)
  const maxPane = paneIds.reduce((max, id) => {
    const match = /^pane-(\d+)$/.exec(id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  const maxTab = tabs.reduce((max, tab) => {
    const match = /^tab-(\d+)$/.exec(tab.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  _paneCounter = Math.max(_paneCounter, maxPane)
  _tabCounter = Math.max(_tabCounter, maxTab)
}

function normalizeHydratedLayout(layout: PaneLayout, tabIds: Set<TabId>, claimedTabs = new Set<TabId>()): PaneLayout {
  if (layout.type === 'leaf') {
    const tabs = layout.tabs.filter((tabId) => {
      if (!tabIds.has(tabId) || claimedTabs.has(tabId)) return false
      claimedTabs.add(tabId)
      return true
    })
    const activeTabId = layout.activeTabId && tabs.includes(layout.activeTabId)
      ? layout.activeTabId
      : (tabs[0] ?? null)
    return { ...layout, tabs, activeTabId }
  }

  return {
    ...layout,
    direction: layout.direction === 'vertical' ? 'vertical' : 'horizontal',
    children: layout.children.map((child) => normalizeHydratedLayout(child, tabIds, claimedTabs)),
    ratio: clampSplitRatio(layout.ratio),
  }
}

function simplifyLayout(layout: PaneLayout): PaneLayout {
  if (layout.type === 'leaf') return layout
  const children = layout.children.map(simplifyLayout)
  if (children.length === 1 && children[0]) return children[0]
  return { ...layout, children }
}

function removeEmptyPanes(layout: PaneLayout): PaneLayout | null {
  if (layout.type === 'leaf') {
    return layout.tabs.length === 0 ? null : layout
  }
  const children = layout.children
    .map(removeEmptyPanes)
    .filter((c): c is PaneLayout => c !== null)
  if (children.length === 0) return null
  if (children.length === 1 && children[0]) return children[0]
  return { ...layout, children }
}

function emptyWorkspaceLayout(): PaneNode {
  return {
    id: 'pane-1',
    type: 'leaf',
    tabs: [],
    activeTabId: null,
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  layout: initialLayout,
  tabs: new Map(),
  activePaneId: initialPaneId,
  pendingFocusPaneId: null,
  sidebarOpen: true,
  sidebarWidth: 240,
  bottomDockOpen: true,
  bottomDockHeight: 240,
  chatPanelOpen: false,
  chatPanelWidth: 360,

  hydrateWorkspace: (input) =>
    set(() => {
      const inputTabsById = new Map(input.tabs.map((tab) => [tab.id, tab]))
      const normalizedLayout = normalizeHydratedLayout(input.layout, new Set(inputTabsById.keys()))
      const layout = collectPaneIds(normalizedLayout).length > 0
        ? normalizedLayout
        : emptyWorkspaceLayout()
      const reachableTabIds = new Set(collectLayoutTabIds(layout))
      const tabs = new Map(
        input.tabs
          .filter((tab) => reachableTabIds.has(tab.id))
          .map((tab) => [tab.id, tab]),
      )
      const paneIds = collectPaneIds(layout)
      const activePaneId = paneIds.includes(input.activePaneId)
        ? input.activePaneId
        : paneIds[0]!
      syncCountersFromWorkspace(layout, [...tabs.values()])
      return {
        layout,
        tabs,
        activePaneId,
        pendingFocusPaneId: null,
        sidebarOpen: input.sidebarOpen,
        sidebarWidth: clampSidebarWidth(input.sidebarWidth),
        bottomDockOpen: input.bottomDockOpen,
        bottomDockHeight: clampBottomDockHeight(input.bottomDockHeight),
        chatPanelOpen: input.chatPanelOpen,
        chatPanelWidth: clampChatPanelWidth(input.chatPanelWidth),
      }
    }),

  openTab: (paneId, type, title, projectId, meta) => {
    const tabId = nextTabId()
    const tab: Tab = { id: tabId, projectId, type, title, meta }
    set((s) => {
      const targetPaneId = layoutHasPane(s.layout, paneId)
        ? paneId
        : (layoutHasPane(s.layout, s.activePaneId) ? s.activePaneId : findFirstPaneId(s.layout))
      const tabs = new Map(s.tabs)
      tabs.set(tabId, tab)
      const layout = findAndUpdatePane(s.layout, targetPaneId, (pane) => ({
        ...pane,
        tabs: [...pane.tabs, tabId],
        activeTabId: tabId,
      }))
      return { tabs, layout, activePaneId: targetPaneId, pendingFocusPaneId: targetPaneId }
    })
    return tabId
  },

  updateTab: (tabId, patch) =>
    set((state) => {
      const current = state.tabs.get(tabId)
      if (!current) return state
      const tabs = new Map(state.tabs)
      tabs.set(tabId, { ...current, ...patch })
      return { tabs }
    }),

  closeTab: (paneId, tabId) =>
    set((s) => {
      if (!paneHasTab(s.layout, paneId, tabId)) return s
      const tabs = new Map(s.tabs)
      tabs.delete(tabId)
      let layout = findAndUpdatePane(s.layout, paneId, (pane) => {
        const newTabs = pane.tabs.filter((t) => t !== tabId)
        const activeTabId = pane.activeTabId === tabId ? (newTabs[newTabs.length - 1] ?? null) : pane.activeTabId
        return { ...pane, tabs: newTabs, activeTabId }
      })
      const cleaned = removeEmptyPanes(layout)
      if (cleaned) layout = simplifyLayout(cleaned)
      else {
        const fallback = nextPaneId()
        layout = { id: fallback, type: 'leaf', tabs: [], activeTabId: null }
      }
      const paneIds = collectPaneIds(layout)
      const activePaneId = paneIds.includes(s.activePaneId) ? s.activePaneId : paneIds[0]
      return { tabs, layout, activePaneId }
    }),

  activateTab: (paneId, tabId) =>
    set((s) => (
      paneHasTab(s.layout, paneId, tabId) && s.tabs.has(tabId)
        ? {
            layout: findAndUpdatePane(s.layout, paneId, (pane) => ({ ...pane, activeTabId: tabId })),
            activePaneId: paneId,
            pendingFocusPaneId: paneId,
          }
        : s
    )),

  setActivePane: (paneId) =>
    set((state) => (
      state.activePaneId === paneId || !layoutHasPane(state.layout, paneId)
        ? state
        : { activePaneId: paneId }
    )),

  clearPendingFocusPane: (paneId) =>
    set((s) => (
      s.pendingFocusPaneId === paneId
        ? { pendingFocusPaneId: null }
        : s
    )),

  splitPane: (paneId, direction) =>
    set((s) => {
      if (!layoutHasPane(s.layout, paneId)) return s
      const newPaneId = nextPaneId()
      const layout = findAndReplace(s.layout, paneId, (pane): PaneSplit => ({
        id: `split-${pane.id}-${newPaneId}`,
        type: 'split',
        direction,
        children: [pane, { id: newPaneId, type: 'leaf', tabs: [], activeTabId: null }],
        ratio: 0.5,
      }))
      return { layout, activePaneId: newPaneId, pendingFocusPaneId: newPaneId }
    }),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
  setBottomDockOpen: (open) => set({ bottomDockOpen: open }),
  setBottomDockHeight: (height) => set({ bottomDockHeight: clampBottomDockHeight(height) }),
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
  setChatPanelWidth: (width) => set({ chatPanelWidth: clampChatPanelWidth(width) }),

  updateSplitRatio: (splitId, ratio) =>
    set((s) => {
      function update(layout: PaneLayout): PaneLayout {
        if (layout.type === 'leaf') return layout
        if (layout.id === splitId) return { ...layout, ratio: clampSplitRatio(ratio) }
        return { ...layout, children: layout.children.map(update) }
      }
      return { layout: update(s.layout) }
    }),
}))
