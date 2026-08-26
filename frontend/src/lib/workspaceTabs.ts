import { browserTabClose, terminalClose } from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'
import type { PaneId, PaneLayout, TabId } from '@/types'

type BackingResource = 'browser' | 'terminal'

function collectTabsByBackingResource(
  node: PaneLayout,
  tabs: ReturnType<typeof useWorkspaceStore.getState>['tabs'],
  resource: BackingResource,
  resourceId: string,
  matches: Array<{ paneId: PaneId; tabId: TabId }>,
) {
  if (node.type === 'leaf') {
    for (const tabId of node.tabs) {
      const tab = tabs.get(tabId)
      const metaKey = resource === 'browser' ? 'tabId' : 'sessionId'
      if (tab?.type === resource && tab.meta?.[metaKey] === resourceId) {
        matches.push({ paneId: node.id, tabId })
      }
    }
    return
  }

  for (const child of node.children) {
    collectTabsByBackingResource(child, tabs, resource, resourceId, matches)
  }
}

function collectTabsByProjectId(
  node: PaneLayout,
  tabs: ReturnType<typeof useWorkspaceStore.getState>['tabs'],
  projectId: string,
  matches: Array<{ paneId: PaneId; tabId: TabId }>,
) {
  if (node.type === 'leaf') {
    for (const tabId of node.tabs) {
      if (tabs.get(tabId)?.projectId === projectId) {
        matches.push({ paneId: node.id, tabId })
      }
    }
    return
  }

  for (const child of node.children) {
    collectTabsByProjectId(child, tabs, projectId, matches)
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

  const terminalSessionId = tab?.type === 'terminal'
    ? ((typeof tab.meta?.sessionId === 'string' && tab.meta.sessionId) || tab.id)
    : null
  if (terminalSessionId && useTerminalStore.getState().sessions.has(terminalSessionId)) {
    await terminalClose(terminalSessionId)
    useTerminalStore.getState().closeSession(terminalSessionId)
  }

  useWorkspaceStore.getState().closeTab(paneId, tabId)
}

export function closeWorkspaceTabsForBrowserTab(browserTabId: string) {
  const workspace = useWorkspaceStore.getState()
  const matches: Array<{ paneId: PaneId; tabId: TabId }> = []
  collectTabsByBackingResource(workspace.layout, workspace.tabs, 'browser', browserTabId, matches)
  for (const match of matches) {
    useWorkspaceStore.getState().closeTab(match.paneId, match.tabId)
  }
}

export function closeWorkspaceTabsForTerminalSession(sessionId: string) {
  const workspace = useWorkspaceStore.getState()
  const matches: Array<{ paneId: PaneId; tabId: TabId }> = []
  collectTabsByBackingResource(workspace.layout, workspace.tabs, 'terminal', sessionId, matches)
  for (const match of matches) {
    useWorkspaceStore.getState().closeTab(match.paneId, match.tabId)
  }
}

export function closeWorkspaceTabsForProject(projectId: string) {
  const workspace = useWorkspaceStore.getState()
  const matches: Array<{ paneId: PaneId; tabId: TabId }> = []
  collectTabsByProjectId(workspace.layout, workspace.tabs, projectId, matches)
  for (const match of matches) {
    useWorkspaceStore.getState().closeTab(match.paneId, match.tabId)
  }
}
