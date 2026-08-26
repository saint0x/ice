import { terminalCreate, toTerminalSession } from '@/lib/backend'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'

function findActiveTabId(
  layout: ReturnType<typeof useWorkspaceStore.getState>['layout'],
  activePaneId: string,
): string | null {
  if (layout.type === 'leaf') {
    return layout.id === activePaneId ? layout.activeTabId : null
  }
  for (const child of layout.children) {
    const tabId = findActiveTabId(child, activePaneId)
    if (tabId) return tabId
  }
  return null
}

export function resolveTerminalProjectId(explicitProjectId?: string | null) {
  if (explicitProjectId) return explicitProjectId

  const projects = useProjectsStore.getState()
  if (projects.activeProjectId) return projects.activeProjectId

  const workspace = useWorkspaceStore.getState()
  const activeTabId = findActiveTabId(workspace.layout, workspace.activePaneId)
  const workspaceProjectId = activeTabId ? workspace.tabs.get(activeTabId)?.projectId : null
  if (workspaceProjectId) return workspaceProjectId

  const terminals = useTerminalStore.getState()
  for (const [projectId, sessionId] of terminals.activeSessionId.entries()) {
    if (sessionId && terminals.sessions.has(sessionId)) {
      return projectId
    }
  }

  if (projects.projectOrder.length === 1) {
    return projects.projectOrder[0] ?? null
  }

  return null
}

export async function createAndFocusTerminalSession(projectId?: string | null) {
  const resolvedProjectId = resolveTerminalProjectId(projectId)
  if (!resolvedProjectId) {
    throw new Error('Unable to determine which project this terminal should use.')
  }

  useWorkspaceStore.getState().setBottomDockOpen(true)

  const session = await terminalCreate(resolvedProjectId)
  const mapped = toTerminalSession(session)
  const store = useTerminalStore.getState()
  store.upsertSession(mapped)
  store.setActiveSession(resolvedProjectId, mapped.id)
  return mapped
}
