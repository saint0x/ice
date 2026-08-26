import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeBrowserTabEverywhere,
  closeTerminalSessionEverywhere,
  closeWorkspaceTab,
  closeWorkspaceTabsForBrowserTab,
  closeWorkspaceTabsForProject,
  closeWorkspaceTabsForTerminalSession,
  reconcileWorkspaceBackingResources,
} from '@/lib/workspaceTabs'
import { browserTabClose, terminalClose } from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'

vi.mock('@/lib/backend', () => ({
  browserTabClose: vi.fn(),
  terminalClose: vi.fn(),
}))

const browserTab = {
  id: 'browser-1',
  projectId: 'project-1',
  title: 'Docs',
  url: 'https://example.com',
  isPinned: false,
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  isSecure: true,
}

const terminalSession = {
  id: 'terminal-1',
  projectId: 'project-1',
  title: 'zsh',
  cwd: '/tmp/project',
  shell: 'zsh',
  shellPath: '/bin/zsh',
  isRunning: true,
}

function resetStores() {
  useWorkspaceStore.setState({
    layout: {
      id: 'pane-1',
      type: 'leaf',
      tabs: ['tab-1'],
      activeTabId: 'tab-1',
    },
    tabs: new Map([
      ['tab-1', {
        id: 'tab-1',
        projectId: 'project-1',
        type: 'browser',
        title: 'Docs',
        meta: { tabId: 'browser-1' },
      }],
    ]),
    activePaneId: 'pane-1',
    pendingFocusPaneId: null,
    sidebarOpen: true,
    sidebarWidth: 240,
    bottomDockOpen: true,
    bottomDockHeight: 240,
    chatPanelOpen: false,
    chatPanelWidth: 360,
  })

  useBrowserStore.setState({
    tabs: new Map([['browser-1', browserTab]]),
    activeTabId: new Map([['project-1', 'browser-1']]),
    sidebarItems: new Map(),
    runtimeNotices: new Map([['browser-1', []]]),
  })
  useTerminalStore.setState({
    sessions: new Map(),
    activeSessionId: new Map(),
    scrollback: new Map(),
    diagnostics: new Map(),
  })
  vi.mocked(browserTabClose).mockReset()
  vi.mocked(terminalClose).mockReset()
}

describe('closeWorkspaceTab', () => {
  beforeEach(() => {
    resetStores()
  })

  it('closes backend browser sessions before removing browser workspace tabs', async () => {
    vi.mocked(browserTabClose).mockResolvedValue(undefined)

    await closeWorkspaceTab('pane-1', 'tab-1')

    expect(browserTabClose).toHaveBeenCalledWith('browser-1')
    expect(useWorkspaceStore.getState().tabs.has('tab-1')).toBe(false)
    expect(useBrowserStore.getState().tabs.has('browser-1')).toBe(false)
  })

  it('keeps a browser workspace tab visible when the backend close fails', async () => {
    vi.mocked(browserTabClose).mockRejectedValue(new Error('backend unavailable'))

    await expect(closeWorkspaceTab('pane-1', 'tab-1')).rejects.toThrow('backend unavailable')

    expect(useWorkspaceStore.getState().tabs.has('tab-1')).toBe(true)
    expect(useBrowserStore.getState().tabs.has('browser-1')).toBe(true)
  })

  it('closes non-browser workspace tabs without calling the browser backend', async () => {
    useWorkspaceStore.setState((state) => ({
      tabs: new Map([
        ['tab-1', {
          ...state.tabs.get('tab-1')!,
          type: 'settings',
          meta: { tool: 'search' },
        }],
      ]),
    }))

    await closeWorkspaceTab('pane-1', 'tab-1')

    expect(browserTabClose).not.toHaveBeenCalled()
    expect(terminalClose).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().tabs.has('tab-1')).toBe(false)
  })

  it('removes every workspace tab backed by a closed browser session', () => {
    useWorkspaceStore.setState((state) => ({
      layout: {
        id: 'split-1',
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
      tabs: new Map([
        ...state.tabs,
        ['tab-2', {
          id: 'tab-2',
          projectId: 'project-1',
          type: 'browser',
          title: 'Docs duplicate',
          meta: { tabId: 'browser-1' },
        }],
      ]),
    }))

    closeWorkspaceTabsForBrowserTab('browser-1')

    expect(useWorkspaceStore.getState().tabs.has('tab-1')).toBe(false)
    expect(useWorkspaceStore.getState().tabs.has('tab-2')).toBe(false)
  })

  it('closes browser backing state and every matching workspace tab together', async () => {
    useWorkspaceStore.setState((state) => ({
      layout: {
        id: 'split-1',
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
      tabs: new Map([
        ...state.tabs,
        ['tab-2', {
          id: 'tab-2',
          projectId: 'project-1',
          type: 'browser',
          title: 'Docs duplicate',
          meta: { tabId: 'browser-1' },
        }],
      ]),
    }))
    vi.mocked(browserTabClose).mockResolvedValue(undefined)

    await closeBrowserTabEverywhere('browser-1')

    expect(browserTabClose).toHaveBeenCalledWith('browser-1')
    expect(useBrowserStore.getState().tabs.has('browser-1')).toBe(false)
    expect(useWorkspaceStore.getState().tabs.has('tab-1')).toBe(false)
    expect(useWorkspaceStore.getState().tabs.has('tab-2')).toBe(false)
  })

  it('keeps browser backing state and workspace tabs when sidebar close fails', async () => {
    vi.mocked(browserTabClose).mockRejectedValue(new Error('backend unavailable'))

    await expect(closeBrowserTabEverywhere('browser-1')).rejects.toThrow('backend unavailable')

    expect(useBrowserStore.getState().tabs.has('browser-1')).toBe(true)
    expect(useWorkspaceStore.getState().tabs.has('tab-1')).toBe(true)
  })

  it('closes backend terminal sessions before removing terminal workspace tabs', async () => {
    useWorkspaceStore.setState((state) => ({
      tabs: new Map([
        ['tab-1', {
          ...state.tabs.get('tab-1')!,
          type: 'terminal',
          meta: { sessionId: 'terminal-1' },
        }],
      ]),
    }))
    useTerminalStore.setState({
      sessions: new Map([['terminal-1', terminalSession]]),
      activeSessionId: new Map([['project-1', 'terminal-1']]),
      scrollback: new Map([['terminal-1', 'hello']]),
      diagnostics: new Map(),
    })
    vi.mocked(terminalClose).mockResolvedValue(undefined)

    await closeWorkspaceTab('pane-1', 'tab-1')

    expect(terminalClose).toHaveBeenCalledWith('terminal-1')
    expect(useWorkspaceStore.getState().tabs.has('tab-1')).toBe(false)
    expect(useTerminalStore.getState().sessions.has('terminal-1')).toBe(false)
  })

  it('keeps a terminal workspace tab visible when the backend close fails', async () => {
    useWorkspaceStore.setState((state) => ({
      tabs: new Map([
        ['tab-1', {
          ...state.tabs.get('tab-1')!,
          type: 'terminal',
          meta: { sessionId: 'terminal-1' },
        }],
      ]),
    }))
    useTerminalStore.setState({
      sessions: new Map([['terminal-1', terminalSession]]),
      activeSessionId: new Map([['project-1', 'terminal-1']]),
      scrollback: new Map(),
      diagnostics: new Map(),
    })
    vi.mocked(terminalClose).mockRejectedValue(new Error('backend unavailable'))

    await expect(closeWorkspaceTab('pane-1', 'tab-1')).rejects.toThrow('backend unavailable')

    expect(useWorkspaceStore.getState().tabs.has('tab-1')).toBe(true)
    expect(useTerminalStore.getState().sessions.has('terminal-1')).toBe(true)
  })

  it('removes every workspace tab backed by a closed terminal session', () => {
    useWorkspaceStore.setState((state) => ({
      layout: {
        id: 'split-1',
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
      tabs: new Map([
        ['tab-1', {
          ...state.tabs.get('tab-1')!,
          type: 'terminal',
          meta: { sessionId: 'terminal-1' },
        }],
        ['tab-2', {
          id: 'tab-2',
          projectId: 'project-1',
          type: 'terminal',
          title: 'zsh duplicate',
          meta: { sessionId: 'terminal-1' },
        }],
      ]),
    }))

    closeWorkspaceTabsForTerminalSession('terminal-1')

    expect(useWorkspaceStore.getState().tabs.has('tab-1')).toBe(false)
    expect(useWorkspaceStore.getState().tabs.has('tab-2')).toBe(false)
  })

  it('closes terminal backing state and every matching workspace tab together', async () => {
    useWorkspaceStore.setState((state) => ({
      layout: {
        id: 'split-1',
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
      tabs: new Map([
        ['tab-1', {
          ...state.tabs.get('tab-1')!,
          type: 'terminal',
          meta: { sessionId: 'terminal-1' },
        }],
        ['tab-2', {
          id: 'tab-2',
          projectId: 'project-1',
          type: 'terminal',
          title: 'zsh duplicate',
          meta: { sessionId: 'terminal-1' },
        }],
      ]),
    }))
    useTerminalStore.setState({
      sessions: new Map([['terminal-1', terminalSession]]),
      activeSessionId: new Map([['project-1', 'terminal-1']]),
      scrollback: new Map([['terminal-1', 'hello']]),
      diagnostics: new Map(),
    })
    vi.mocked(terminalClose).mockResolvedValue(undefined)

    await closeTerminalSessionEverywhere('terminal-1')

    expect(terminalClose).toHaveBeenCalledWith('terminal-1')
    expect(useTerminalStore.getState().sessions.has('terminal-1')).toBe(false)
    expect(useWorkspaceStore.getState().tabs.has('tab-1')).toBe(false)
    expect(useWorkspaceStore.getState().tabs.has('tab-2')).toBe(false)
  })

  it('keeps terminal backing state and workspace tabs when sidebar close fails', async () => {
    useWorkspaceStore.setState((state) => ({
      tabs: new Map([
        ['tab-1', {
          ...state.tabs.get('tab-1')!,
          type: 'terminal',
          meta: { sessionId: 'terminal-1' },
        }],
      ]),
    }))
    useTerminalStore.setState({
      sessions: new Map([['terminal-1', terminalSession]]),
      activeSessionId: new Map([['project-1', 'terminal-1']]),
      scrollback: new Map(),
      diagnostics: new Map(),
    })
    vi.mocked(terminalClose).mockRejectedValue(new Error('backend unavailable'))

    await expect(closeTerminalSessionEverywhere('terminal-1')).rejects.toThrow('backend unavailable')

    expect(useTerminalStore.getState().sessions.has('terminal-1')).toBe(true)
    expect(useWorkspaceStore.getState().tabs.has('tab-1')).toBe(true)
  })

  it('removes every workspace tab owned by a project', () => {
    useWorkspaceStore.setState((state) => ({
      layout: {
        id: 'split-1',
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
      tabs: new Map([
        ...state.tabs,
        ['tab-2', {
          id: 'tab-2',
          projectId: 'project-2',
          type: 'editor',
          title: 'keep.ts',
          meta: { path: 'keep.ts' },
        }],
      ]),
    }))

    closeWorkspaceTabsForProject('project-1')

    expect([...useWorkspaceStore.getState().tabs.values()].map((tab) => tab.projectId)).toEqual(['project-2'])
  })

  it('removes restored browser and terminal workspace tabs whose backing resources are absent', () => {
    useWorkspaceStore.setState({
      layout: {
        id: 'split-root',
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          {
            id: 'pane-1',
            type: 'leaf',
            tabs: ['tab-browser-live', 'tab-browser-stale', 'tab-browser-missing-meta'],
            activeTabId: 'tab-browser-stale',
          },
          {
            id: 'pane-2',
            type: 'leaf',
            tabs: ['tab-terminal-live', 'tab-terminal-stale', 'tab-editor-live', 'tab-git-live'],
            activeTabId: 'tab-terminal-stale',
          },
        ],
      },
      tabs: new Map([
        ['tab-browser-live', {
          id: 'tab-browser-live',
          projectId: 'project-1',
          type: 'browser',
          title: 'Docs',
          meta: { tabId: 'browser-live' },
        }],
        ['tab-browser-stale', {
          id: 'tab-browser-stale',
          projectId: 'project-1',
          type: 'browser',
          title: 'Old docs',
          meta: { tabId: 'browser-stale' },
        }],
        ['tab-browser-missing-meta', {
          id: 'tab-browser-missing-meta',
          projectId: 'project-1',
          type: 'browser',
          title: 'Unknown browser',
        }],
        ['tab-terminal-live', {
          id: 'tab-terminal-live',
          projectId: 'project-1',
          type: 'terminal',
          title: 'zsh',
          meta: { sessionId: 'terminal-live' },
        }],
        ['tab-terminal-stale', {
          id: 'tab-terminal-stale',
          projectId: 'project-1',
          type: 'terminal',
          title: 'old zsh',
          meta: { sessionId: 'terminal-stale' },
        }],
        ['tab-editor-live', {
          id: 'tab-editor-live',
          projectId: 'project-1',
          type: 'editor',
          title: 'index.ts',
          meta: { path: 'index.ts' },
        }],
        ['tab-git-live', {
          id: 'tab-git-live',
          projectId: 'project-1',
          type: 'git',
          title: 'Git',
        }],
      ]),
      activePaneId: 'pane-2',
      pendingFocusPaneId: null,
      sidebarOpen: true,
      sidebarWidth: 240,
      bottomDockOpen: true,
      bottomDockHeight: 240,
      chatPanelOpen: false,
      chatPanelWidth: 360,
    })

    reconcileWorkspaceBackingResources({
      browserTabIds: ['browser-live'],
      terminalSessionIds: ['terminal-live'],
    })

    const state = useWorkspaceStore.getState()
    expect([...state.tabs.keys()]).toEqual([
      'tab-browser-live',
      'tab-terminal-live',
      'tab-editor-live',
      'tab-git-live',
    ])
    expect(state.layout).toMatchObject({
      type: 'split',
      children: [
        {
          id: 'pane-1',
          tabs: ['tab-browser-live'],
          activeTabId: 'tab-browser-live',
        },
        {
          id: 'pane-2',
          tabs: ['tab-terminal-live', 'tab-editor-live', 'tab-git-live'],
          activeTabId: 'tab-git-live',
        },
      ],
    })
  })

  it('keeps terminal workspace tabs whose tab id is the live backing session id', () => {
    useWorkspaceStore.setState((state) => ({
      tabs: new Map([
        ['terminal-1', {
          ...state.tabs.get('tab-1')!,
          id: 'terminal-1',
          type: 'terminal',
          meta: undefined,
        }],
      ]),
      layout: {
        id: 'pane-1',
        type: 'leaf',
        tabs: ['terminal-1'],
        activeTabId: 'terminal-1',
      },
    }))

    reconcileWorkspaceBackingResources({
      browserTabIds: [],
      terminalSessionIds: ['terminal-1'],
    })

    expect(useWorkspaceStore.getState().tabs.has('terminal-1')).toBe(true)
  })
})
