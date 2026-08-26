import { browserTabClose } from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
import { useWorkspaceStore } from '@/stores/workspace'
import type { PaneId, PaneLayout, TabId } from '@/types'

function collectTabsByBrowserTabId(
  node: PaneLayout,
  tabs: ReturnType<typeof useWorkspaceStore.getState>['tabs'],
  browserTabId: string,
  matches: Array<{ paneId: PaneId; tabId: TabId }>,
) {
  if (node.type === 'leaf') {
    for (const tabId of node.tabs) {
      const tab = tabs.get(tabId)
      if (tab?.type === 'browser' && tab.meta?.tabId === browserTabId) {
        matches.push({ paneId: node.id, tabId })
      }
    }
    return
  }

  for (const child of node.children) {
    collectTabsByBrowserTabId(child, tabs, browserTabId, matches)
  }
}

export async function closeWorkspaceTab(paneId: PaneId, tabId: TabId) {
  const workspace = useWorkspaceStore.getState()
  const tab = workspace.tabs.get(tabId)
  const browserTabId = tab?.type === 'browser' && typeof tab.meta?.tabId === 'string'
    ? tab.meta.tabId
    : null

  if (browserTabId && useBrowserStore.getState().tabs.has(browserTabId)) {
    await browserTabClose(browserTabId)
    useBrowserStore.getState().closeTab(browserTabId)
  }

  useWorkspaceStore.getState().closeTab(paneId, tabId)
}

export function closeWorkspaceTabsForBrowserTab(browserTabId: string) {
  const workspace = useWorkspaceStore.getState()
  const matches: Array<{ paneId: PaneId; tabId: TabId }> = []
  collectTabsByBrowserTabId(workspace.layout, workspace.tabs, browserTabId, matches)
  for (const match of matches) {
    useWorkspaceStore.getState().closeTab(match.paneId, match.tabId)
  }
}
