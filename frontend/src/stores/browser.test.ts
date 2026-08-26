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
})
