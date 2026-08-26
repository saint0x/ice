import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeWorkspaceTab, closeWorkspaceTabsForBrowserTab } from '@/lib/workspaceTabs'
import { browserTabClose } from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
import { useWorkspaceStore } from '@/stores/workspace'

vi.mock('@/lib/backend', () => ({
  browserTabClose: vi.fn(),
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
  vi.mocked(browserTabClose).mockReset()
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
})
