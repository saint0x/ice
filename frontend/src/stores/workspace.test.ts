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

  it('normalizes stale tab and pane references during hydration', () => {
    useWorkspaceStore.getState().hydrateWorkspace({
      layout: {
        id: 'split-root',
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          {
            id: 'pane-10',
            type: 'leaf',
            tabs: ['tab-live', 'tab-missing', 'tab-duplicate'],
            activeTabId: 'tab-missing',
          },
          {
            id: 'pane-11',
            type: 'leaf',
            tabs: ['tab-duplicate'],
            activeTabId: 'tab-duplicate',
          },
        ],
      },
      tabs: [
        {
          id: 'tab-live',
          type: 'editor',
          title: 'index.ts',
          projectId: 'project-1',
          meta: { path: 'index.ts' },
        },
        {
          id: 'tab-duplicate',
          type: 'terminal',
          title: 'zsh',
          projectId: 'project-1',
          meta: { sessionId: 'session-1' },
        },
        {
          id: 'tab-orphan',
          type: 'git',
          title: 'Git',
          projectId: 'project-1',
        },
      ],
      activePaneId: 'pane-missing',
      sidebarOpen: true,
      sidebarWidth: 240,
      bottomDockOpen: true,
      bottomDockHeight: 240,
      chatPanelOpen: false,
      chatPanelWidth: 360,
    })

    const state = useWorkspaceStore.getState()
    expect(state.activePaneId).toBe('pane-10')
    expect([...state.tabs.keys()]).toEqual(['tab-live', 'tab-duplicate'])
    expect(state.tabs.has('tab-orphan')).toBe(false)
    expect(state.layout).toMatchObject({
      type: 'split',
      children: [
        {
          type: 'leaf',
          tabs: ['tab-live', 'tab-duplicate'],
          activeTabId: 'tab-live',
        },
        {
          type: 'leaf',
          tabs: [],
          activeTabId: null,
        },
      ],
    })
  })
})
