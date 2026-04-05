import { create } from 'zustand'
import type { PaneLayout, PaneNode, PaneSplit, PaneId, TabId, Tab, ContentType, ProjectId, SplitDirection } from '@/types'

let _paneCounter = 0
let _tabCounter = 0
const nextPaneId = (): PaneId => `pane-${++_paneCounter}`
const nextTabId = (): TabId => `tab-${++_tabCounter}`

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
      syncCountersFromWorkspace(input.layout, input.tabs)
      return {
        layout: input.layout,
        tabs: new Map(input.tabs.map((tab) => [tab.id, tab])),
        activePaneId: input.activePaneId,
        pendingFocusPaneId: null,
        sidebarOpen: input.sidebarOpen,
        sidebarWidth: input.sidebarWidth,
        bottomDockOpen: input.bottomDockOpen,
        bottomDockHeight: input.bottomDockHeight,
        chatPanelOpen: input.chatPanelOpen,
        chatPanelWidth: input.chatPanelWidth,
      }
    }),

  openTab: (paneId, type, title, projectId, meta) => {
    const tabId = nextTabId()
    const tab: Tab = { id: tabId, projectId, type, title, meta }
    set((s) => {
      const tabs = new Map(s.tabs)
      tabs.set(tabId, tab)
      const layout = findAndUpdatePane(s.layout, paneId, (pane) => ({
        ...pane,
        tabs: [...pane.tabs, tabId],
        activeTabId: tabId,
      }))
      return { tabs, layout, activePaneId: paneId, pendingFocusPaneId: paneId }
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
    set((s) => ({
      layout: findAndUpdatePane(s.layout, paneId, (pane) => ({ ...pane, activeTabId: tabId })),
      activePaneId: paneId,
      pendingFocusPaneId: paneId,
    })),

  setActivePane: (paneId) => set({ activePaneId: paneId, pendingFocusPaneId: paneId }),

  clearPendingFocusPane: (paneId) =>
    set((s) => (
      s.pendingFocusPaneId === paneId
        ? { pendingFocusPaneId: null }
        : s
    )),

  splitPane: (paneId, direction) =>
    set((s) => {
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
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(400, width)) }),
  setBottomDockOpen: (open) => set({ bottomDockOpen: open }),
  setBottomDockHeight: (height) => set({ bottomDockHeight: Math.max(100, Math.min(600, height)) }),
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
  setChatPanelWidth: (width) => set({ chatPanelWidth: Math.max(280, Math.min(520, width)) }),

  updateSplitRatio: (splitId, ratio) =>
    set((s) => {
      function update(layout: PaneLayout): PaneLayout {
        if (layout.type === 'leaf') return layout
        if (layout.id === splitId) return { ...layout, ratio: Math.max(0.15, Math.min(0.85, ratio)) }
        return { ...layout, children: layout.children.map(update) }
      }
      return { layout: update(s.layout) }
    }),
}))
