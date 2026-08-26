import { terminalCreate, toTerminalSession } from '@/lib/backend'
import { resolveWorkbenchProjectId } from '@/lib/projectResolution'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'

export function resolveTerminalProjectId(explicitProjectId?: string | null) {
  const resolvedProjectId = resolveWorkbenchProjectId(explicitProjectId)
  if (resolvedProjectId) return resolvedProjectId
  const terminals = useTerminalStore.getState()
  for (const [projectId, sessionId] of terminals.activeSessionId.entries()) {
    if (sessionId && terminals.sessions.has(sessionId) && useProjectsStore.getState().projects.has(projectId)) {
      return projectId
    }
  }

  return null
}

export async function createAndFocusTerminalSession(projectId?: string | null) {
  const resolvedProjectId = resolveTerminalProjectId(projectId)
  if (!resolvedProjectId) {
    throw new Error('Unable to determine which project this terminal should use.')
  }

  const session = await terminalCreate(resolvedProjectId)
  const mapped = toTerminalSession(session)
  useWorkspaceStore.getState().setBottomDockOpen(true)
  const store = useTerminalStore.getState()
  store.upsertSession(mapped)
  store.setActiveSession(resolvedProjectId, mapped.id)
  return mapped
}
