import { browserTabClose, terminalClose } from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'
import type { PaneId, PaneLayout, ProjectId, TabId } from '@/types'

type BackingResource = 'browser' | 'terminal'
type WorkspaceTabRecord = ReturnType<typeof useWorkspaceStore.getState>['tabs'] extends Map<TabId, infer T> ? T : never

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

function collectTabsByPredicate(
  node: PaneLayout,
  tabs: ReturnType<typeof useWorkspaceStore.getState>['tabs'],
  matches: Array<{ paneId: PaneId; tabId: TabId }>,
  predicate: (tab: WorkspaceTabRecord) => boolean,
) {
  if (node.type === 'leaf') {
    for (const tabId of node.tabs) {
      const tab = tabs.get(tabId)
      if (tab && predicate(tab)) {
        matches.push({ paneId: node.id, tabId })
      }
    }
    return
  }

  for (const child of node.children) {
    collectTabsByPredicate(child, tabs, matches, predicate)
  }
}

export async function closeWorkspaceTab(paneId: PaneId, tabId: TabId) {
  const workspace = useWorkspaceStore.getState()
  const tab = workspace.tabs.get(tabId)
  const browserTabId = tab?.type === 'browser' && typeof tab.meta?.tabId === 'string'
    ? tab.meta.tabId
    : null

  if (browserTabId) {
    await closeBrowserTabEverywhere(browserTabId)
    return
  }

  const terminalSessionId = tab?.type === 'terminal'
    ? ((typeof tab.meta?.sessionId === 'string' && tab.meta.sessionId) || tab.id)
    : null
  if (terminalSessionId) {
    await closeTerminalSessionEverywhere(terminalSessionId)
    return
  }

  useWorkspaceStore.getState().closeTab(paneId, tabId)
}

export async function closeBrowserTabEverywhere(browserTabId: string) {
  if (useBrowserStore.getState().tabs.has(browserTabId)) {
    await browserTabClose(browserTabId)
    useBrowserStore.getState().closeTab(browserTabId)
  }
  closeWorkspaceTabsForBrowserTab(browserTabId)
}

export function closeWorkspaceTabsForBrowserTab(browserTabId: string) {
  const workspace = useWorkspaceStore.getState()
  const matches: Array<{ paneId: PaneId; tabId: TabId }> = []
  collectTabsByBackingResource(workspace.layout, workspace.tabs, 'browser', browserTabId, matches)
  for (const match of matches) {
    useWorkspaceStore.getState().closeTab(match.paneId, match.tabId)
  }
}

export async function closeTerminalSessionEverywhere(sessionId: string) {
  if (useTerminalStore.getState().sessions.has(sessionId)) {
    await terminalClose(sessionId)
    useTerminalStore.getState().closeSession(sessionId)
  }
  closeWorkspaceTabsForTerminalSession(sessionId)
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

export function openOrFocusBrowserWorkspaceTab(
  projectId: ProjectId,
  title: string,
  browserTabId: string,
  url: string,
) {
  const workspace = useWorkspaceStore.getState()
  const matches: Array<{ paneId: PaneId; tabId: TabId }> = []
  collectTabsByPredicate(
    workspace.layout,
    workspace.tabs,
    matches,
    (tab) => (
      tab.projectId === projectId
      && tab.type === 'browser'
      && tab.meta?.tabId === browserTabId
    ),
  )

  const existing = matches[0]
  if (existing) {
    useWorkspaceStore.getState().activateTab(existing.paneId, existing.tabId)
    useWorkspaceStore.getState().updateTab(existing.tabId, {
      title,
      meta: { tabId: browserTabId, url },
    })
    return existing.tabId
  }

  return workspace.openTab(workspace.activePaneId, 'browser', title, projectId, { tabId: browserTabId, url })
}

export function openOrFocusCodexWorkspaceTab(
  projectId: ProjectId,
  title: string,
  threadId: string,
) {
  const workspace = useWorkspaceStore.getState()
  const matches: Array<{ paneId: PaneId; tabId: TabId }> = []
  collectTabsByPredicate(
    workspace.layout,
    workspace.tabs,
    matches,
    (tab) => (
      tab.projectId === projectId
      && tab.type === 'codex'
      && tab.meta?.threadId === threadId
    ),
  )

  const existing = matches[0]
  if (existing) {
    useWorkspaceStore.getState().activateTab(existing.paneId, existing.tabId)
    useWorkspaceStore.getState().updateTab(existing.tabId, {
      title,
      meta: { threadId },
    })
    return existing.tabId
  }

  return workspace.openTab(workspace.activePaneId, 'codex', title, projectId, { threadId })
}

export function reconcileWorkspaceBackingResources(input: {
  browserTabIds: Iterable<string>
  terminalSessionIds: Iterable<string>
  codexThreadIds?: Iterable<string>
}) {
  const browserTabIds = new Set(input.browserTabIds)
  const terminalSessionIds = new Set(input.terminalSessionIds)
  const codexThreadIds = input.codexThreadIds ? new Set(input.codexThreadIds) : null
  const workspace = useWorkspaceStore.getState()
  const matches: Array<{ paneId: PaneId; tabId: TabId }> = []

  collectTabsByPredicate(
    workspace.layout,
    workspace.tabs,
    matches,
    (tab) => {
      if (tab.type === 'browser') {
        const browserTabId = typeof tab.meta?.tabId === 'string' ? tab.meta.tabId : null
        return !browserTabId || !browserTabIds.has(browserTabId)
      }
      if (tab.type === 'terminal') {
        const terminalSessionId = typeof tab.meta?.sessionId === 'string' ? tab.meta.sessionId : tab.id
        return !terminalSessionIds.has(terminalSessionId)
      }
      if (tab.type === 'codex' && codexThreadIds) {
        const threadId = typeof tab.meta?.threadId === 'string' ? tab.meta.threadId : null
        return Boolean(threadId && !codexThreadIds.has(threadId))
      }
      return false
    },
  )

  for (const match of matches) {
    useWorkspaceStore.getState().closeTab(match.paneId, match.tabId)
  }
}
