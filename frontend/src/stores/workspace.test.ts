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

  it('opens tabs in an existing pane when the requested pane is stale', () => {
    const tabId = useWorkspaceStore.getState().openTab('pane-missing', 'settings', 'Search', 'project-1')

    const state = useWorkspaceStore.getState()
    expect(state.tabs.has(tabId)).toBe(true)
    expect(state.layout).toMatchObject({
      id: 'pane-1',
      tabs: [tabId],
      activeTabId: tabId,
    })
    expect(state.activePaneId).toBe('pane-1')
  })

  it('ignores activation when the pane does not own the tab', () => {
    useWorkspaceStore.getState().hydrateWorkspace({
      layout: {
        id: 'split-root',
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          {
            id: 'pane-1',
            type: 'leaf',
            tabs: ['tab-1'],
            activeTabId: 'tab-1',
          },
          {
            id: 'pane-2',
            type: 'leaf',
            tabs: ['tab-2'],
            activeTabId: 'tab-2',
          },
        ],
      },
      tabs: [
        {
          id: 'tab-1',
          type: 'editor',
          title: 'index.ts',
          projectId: 'project-1',
        },
        {
          id: 'tab-2',
          type: 'git',
          title: 'Git',
          projectId: 'project-1',
        },
      ],
      activePaneId: 'pane-1',
      sidebarOpen: true,
      sidebarWidth: 240,
      bottomDockOpen: true,
      bottomDockHeight: 240,
      chatPanelOpen: false,
      chatPanelWidth: 360,
    })

    useWorkspaceStore.getState().activateTab('pane-1', 'tab-2')

    const state = useWorkspaceStore.getState()
    expect(state.activePaneId).toBe('pane-1')
    expect(state.layout).toMatchObject({
      children: [
        {
          id: 'pane-1',
          activeTabId: 'tab-1',
        },
        {
          id: 'pane-2',
          activeTabId: 'tab-2',
        },
      ],
    })
  })

  it('does not delete a tab when close targets the wrong pane', () => {
    useWorkspaceStore.getState().hydrateWorkspace({
      layout: {
        id: 'split-root',
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          {
            id: 'pane-1',
            type: 'leaf',
            tabs: ['tab-1'],
            activeTabId: 'tab-1',
          },
          {
            id: 'pane-2',
            type: 'leaf',
            tabs: ['tab-2'],
            activeTabId: 'tab-2',
          },
        ],
      },
      tabs: [
        {
          id: 'tab-1',
          type: 'editor',
          title: 'index.ts',
          projectId: 'project-1',
        },
        {
          id: 'tab-2',
          type: 'git',
          title: 'Git',
          projectId: 'project-1',
        },
      ],
      activePaneId: 'pane-1',
      sidebarOpen: true,
      sidebarWidth: 240,
      bottomDockOpen: true,
      bottomDockHeight: 240,
      chatPanelOpen: false,
      chatPanelWidth: 360,
    })

    useWorkspaceStore.getState().closeTab('pane-1', 'tab-2')

    const state = useWorkspaceStore.getState()
    expect(state.tabs.has('tab-2')).toBe(true)
    expect(state.layout).toMatchObject({
      children: [
        {
          id: 'pane-1',
          tabs: ['tab-1'],
        },
        {
          id: 'pane-2',
          tabs: ['tab-2'],
        },
      ],
    })
  })

  it('clears pending focus when closing a tab removes that pane', () => {
    useWorkspaceStore.getState().hydrateWorkspace({
      layout: {
        id: 'split-root',
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          {
            id: 'pane-1',
            type: 'leaf',
            tabs: ['tab-1'],
            activeTabId: 'tab-1',
          },
          {
            id: 'pane-2',
            type: 'leaf',
            tabs: ['tab-2'],
            activeTabId: 'tab-2',
          },
        ],
      },
      tabs: [
        {
          id: 'tab-1',
          type: 'editor',
          title: 'index.ts',
          projectId: 'project-1',
        },
        {
          id: 'tab-2',
          type: 'git',
          title: 'Git',
          projectId: 'project-1',
        },
      ],
      activePaneId: 'pane-1',
      sidebarOpen: true,
      sidebarWidth: 240,
      bottomDockOpen: true,
      bottomDockHeight: 240,
      chatPanelOpen: false,
      chatPanelWidth: 360,
    })
    useWorkspaceStore.setState({ pendingFocusPaneId: 'pane-2' })

    useWorkspaceStore.getState().closeTab('pane-2', 'tab-2')

    const state = useWorkspaceStore.getState()
    expect(state.activePaneId).toBe('pane-1')
    expect(state.pendingFocusPaneId).toBeNull()
    expect(state.layout).toMatchObject({
      id: 'pane-1',
      tabs: ['tab-1'],
      activeTabId: 'tab-1',
    })
  })

  it('ignores pane focus and split requests for missing panes', () => {
    useWorkspaceStore.getState().setActivePane('pane-missing')
    useWorkspaceStore.getState().splitPane('pane-missing', 'vertical')

    const state = useWorkspaceStore.getState()
    expect(state.activePaneId).toBe('pane-1')
    expect(state.layout).toEqual({
      id: 'pane-1',
      type: 'leaf',
      tabs: [],
      activeTabId: null,
    })
  })

  it('clamps restored chrome dimensions during hydration', () => {
    useWorkspaceStore.getState().hydrateWorkspace({
      layout: {
        id: 'pane-1',
        type: 'leaf',
        tabs: [],
        activeTabId: null,
      },
      tabs: [],
      activePaneId: 'pane-1',
      sidebarOpen: true,
      sidebarWidth: 20,
      bottomDockOpen: true,
      bottomDockHeight: 5000,
      chatPanelOpen: true,
      chatPanelWidth: 50,
    })

    const state = useWorkspaceStore.getState()
    expect(state.sidebarWidth).toBe(180)
    expect(state.bottomDockHeight).toBe(600)
    expect(state.chatPanelWidth).toBe(280)
  })

  it('normalizes stale tab and pane references during hydration', () => {
    useWorkspaceStore.getState().hydrateWorkspace({
      layout: {
        id: 'split-root',
        type: 'split',
        direction: 'diagonal' as 'horizontal',
        ratio: 1.2,
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
      direction: 'horizontal',
      ratio: 0.85,
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

  it('recovers pane-less hydrated layouts to a valid empty workspace', () => {
    useWorkspaceStore.getState().hydrateWorkspace({
      layout: {
        id: 'split-empty',
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [],
      },
      tabs: [
        {
          id: 'tab-orphan',
          type: 'editor',
          title: 'orphan.ts',
          projectId: 'project-1',
          meta: { path: 'orphan.ts' },
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
    expect(state.activePaneId).toBe('pane-1')
    expect(state.tabs.size).toBe(0)
    expect(state.layout).toEqual({
      id: 'pane-1',
      type: 'leaf',
      tabs: [],
      activeTabId: null,
    })
  })

  it('drops hydrated tabs with blank identifiers before layout reconciliation', () => {
    useWorkspaceStore.getState().hydrateWorkspace({
      layout: {
        id: 'pane-1',
        type: 'leaf',
        tabs: ['tab-live', ' ', 'tab-blank-project'],
        activeTabId: ' ',
      },
      tabs: [
        {
          id: 'tab-live',
          type: 'editor',
          title: 'index.ts',
          projectId: 'project-1',
        },
        {
          id: ' ',
          type: 'browser',
          title: 'Blank tab',
          projectId: 'project-1',
        },
        {
          id: 'tab-blank-project',
          type: 'terminal',
          title: 'Blank project',
          projectId: ' ',
        },
      ],
      activePaneId: 'pane-1',
      sidebarOpen: true,
      sidebarWidth: 240,
      bottomDockOpen: true,
      bottomDockHeight: 240,
      chatPanelOpen: false,
      chatPanelWidth: 360,
    })

    const state = useWorkspaceStore.getState()
    expect([...state.tabs.keys()]).toEqual(['tab-live'])
    expect(state.layout).toMatchObject({
      id: 'pane-1',
      tabs: ['tab-live'],
      activeTabId: 'tab-live',
    })
  })
})
