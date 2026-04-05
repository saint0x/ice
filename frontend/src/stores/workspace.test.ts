import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace'

describe('workspace store focus synchronization', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      layout: {
        id: 'pane-1',
        type: 'leaf',
        tabs: [],
        activeTabId: null,
      },
      tabs: new Map(),
      activePaneId: 'pane-1',
      pendingFocusPaneId: null,
      sidebarOpen: true,
      sidebarWidth: 240,
      bottomDockOpen: true,
      bottomDockHeight: 240,
      chatPanelOpen: false,
      chatPanelWidth: 360,
    })
  })

  it('marks a newly opened tab for focus in the destination pane', () => {
    const tabId = useWorkspaceStore.getState().openTab('pane-1', 'settings', 'Search', 'project-1', { tool: 'search' })
    const state = useWorkspaceStore.getState()
    expect(state.tabs.get(tabId)?.projectId).toBe('project-1')
    expect(state.activePaneId).toBe('pane-1')
    expect(state.pendingFocusPaneId).toBe('pane-1')
  })

  it('moves focus to the new pane when splitting', () => {
    useWorkspaceStore.getState().splitPane('pane-1', 'horizontal')
    const state = useWorkspaceStore.getState()
    expect(state.activePaneId).toBe('pane-2')
    expect(state.pendingFocusPaneId).toBe('pane-2')
  })
})
