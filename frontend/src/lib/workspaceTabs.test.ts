import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeWorkspaceTab,
  closeWorkspaceTabsForBrowserTab,
  closeWorkspaceTabsForTerminalSession,
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
})
