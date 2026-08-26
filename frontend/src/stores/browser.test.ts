import { beforeEach, describe, expect, it } from 'vitest'
import { useBrowserStore } from '@/stores/browser'

const browserTab = {
  id: 'browser-live',
  projectId: 'project-1',
  title: 'Docs',
  url: 'https://example.com',
  isPinned: false,
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  isSecure: true,
}

describe('browser store hydration', () => {
  beforeEach(() => {
    useBrowserStore.setState({
      tabs: new Map(),
      activeTabId: new Map(),
      sidebarItems: new Map(),
      runtimeNotices: new Map(),
    })
  })

  it('reconciles active tab ids and runtime notices to hydrated backend tabs', () => {
    useBrowserStore.setState({
      tabs: new Map([
        ['browser-stale', {
          ...browserTab,
          id: 'browser-stale',
        }],
      ]),
      activeTabId: new Map([
        ['project-1', 'browser-stale'],
        ['project-2', 'browser-missing'],
      ]),
      runtimeNotices: new Map([
        ['browser-stale', [{
          id: 'notice-1',
          projectId: 'project-1',
          tabId: 'browser-stale',
          kind: 'rendererDetached',
          message: 'Renderer detached',
          createdAt: '2026-01-01T00:00:00Z',
        }]],
        ['browser-live', [{
          id: 'notice-2',
          projectId: 'project-1',
          tabId: 'browser-live',
          kind: 'rendererAttached',
          message: 'Renderer attached',
          createdAt: '2026-01-01T00:00:00Z',
        }]],
      ]),
    })

    useBrowserStore.getState().hydrateTabs([browserTab])

    const state = useBrowserStore.getState()
    expect(state.tabs.has('browser-stale')).toBe(false)
    expect(state.activeTabId.get('project-1')).toBe('browser-live')
    expect(state.activeTabId.get('project-2')).toBeNull()
    expect(state.runtimeNotices.has('browser-stale')).toBe(false)
    expect(state.runtimeNotices.has('browser-live')).toBe(true)
  })

  it('reconciles sidebar browser rows to hydrated backend tabs', () => {
    useBrowserStore.setState({
      tabs: new Map([
        ['browser-stale', {
          ...browserTab,
          id: 'browser-stale',
        }],
      ]),
      activeTabId: new Map(),
      sidebarItems: new Map([
        ['project-1', [
          { tabId: 'browser-stale', title: 'Stale', url: 'https://example.com/stale', isPinned: false, isLoading: false, isSecure: true },
          { tabId: 'browser-live', title: 'Live', url: 'https://example.com', isPinned: false, isLoading: false, isSecure: true },
        ]],
      ]),
      runtimeNotices: new Map(),
    })

    useBrowserStore.getState().hydrateTabs([browserTab])

    expect(useBrowserStore.getState().sidebarItems.get('project-1')).toEqual([
      { tabId: 'browser-live', title: 'Live', url: 'https://example.com', isPinned: false, isLoading: false, isSecure: true },
    ])
  })

  it('drops stale browser sidebar rows during sidebar hydration and tab close', () => {
    useBrowserStore.setState({
      tabs: new Map([['browser-live', browserTab]]),
      activeTabId: new Map([['project-1', 'browser-live']]),
      sidebarItems: new Map(),
      runtimeNotices: new Map(),
    })

    useBrowserStore.getState().hydrateSidebarItems('project-1', [
      { tabId: 'browser-live', title: 'Live', url: 'https://example.com', isPinned: false, isLoading: false, isSecure: true },
      { tabId: 'browser-missing', title: 'Missing', url: 'https://example.com/missing', isPinned: false, isLoading: false, isSecure: true },
    ])
    expect(useBrowserStore.getState().sidebarItems.get('project-1')?.map((item) => item.tabId)).toEqual(['browser-live'])

    useBrowserStore.getState().closeTab('browser-live')

    expect(useBrowserStore.getState().sidebarItems.get('project-1')).toEqual([])
  })

  it('ignores runtime notices for closed or cross-project browser tabs', () => {
    useBrowserStore.setState({
      tabs: new Map([['browser-live', browserTab]]),
      activeTabId: new Map(),
      sidebarItems: new Map(),
      runtimeNotices: new Map(),
    })

    useBrowserStore.getState().pushRuntimeNotice({
      id: 'notice-missing',
      projectId: 'project-1',
      tabId: 'browser-missing',
      kind: 'rendererDetached',
      message: 'Renderer detached',
      createdAt: '2026-01-01T00:00:00Z',
    })
    useBrowserStore.getState().pushRuntimeNotice({
      id: 'notice-cross-project',
      projectId: 'project-2',
      tabId: 'browser-live',
      kind: 'rendererDetached',
      message: 'Renderer detached',
      createdAt: '2026-01-01T00:00:01Z',
    })
    useBrowserStore.getState().pushRuntimeNotice({
      id: 'notice-live',
      projectId: 'project-1',
      tabId: 'browser-live',
      kind: 'rendererAttached',
      message: 'Renderer attached',
      createdAt: '2026-01-01T00:00:02Z',
    })

    expect(useBrowserStore.getState().runtimeNotices.has('browser-missing')).toBe(false)
    expect(useBrowserStore.getState().runtimeNotices.get('browser-live')?.map((notice) => notice.id)).toEqual(['notice-live'])
  })

  it('ignores attempts to activate missing or cross-project browser tabs', () => {
    useBrowserStore.setState({
      tabs: new Map([
        ['browser-live', browserTab],
        ['browser-other', {
          ...browserTab,
          id: 'browser-other',
          projectId: 'project-2',
        }],
      ]),
      activeTabId: new Map([['project-1', 'browser-live']]),
      sidebarItems: new Map(),
      runtimeNotices: new Map(),
    })

    useBrowserStore.getState().setActiveTab('project-1', 'browser-missing')
    expect(useBrowserStore.getState().activeTabId.get('project-1')).toBe('browser-live')

    useBrowserStore.getState().setActiveTab('project-1', 'browser-other')
    expect(useBrowserStore.getState().activeTabId.get('project-1')).toBe('browser-live')
  })

  it('falls back to a real project tab when the stored active browser tab is stale', () => {
    useBrowserStore.setState({
      tabs: new Map([['browser-live', browserTab]]),
      activeTabId: new Map([['project-1', 'browser-stale']]),
      sidebarItems: new Map(),
      runtimeNotices: new Map(),
    })

    useBrowserStore.getState().setActiveTab('project-1', 'browser-missing')

    expect(useBrowserStore.getState().activeTabId.get('project-1')).toBe('browser-live')
  })
})
