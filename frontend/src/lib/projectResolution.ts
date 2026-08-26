import { useProjectsStore } from '@/stores/projects'
import { useWorkspaceStore } from '@/stores/workspace'
import type { PaneLayout, ProjectId, Tab } from '@/types'

export function findActiveTabId(layout: PaneLayout, activePaneId: string): string | null {
  if (layout.type === 'leaf') {
    return layout.id === activePaneId ? layout.activeTabId : null
  }
  for (const child of layout.children) {
    const activeTabId = findActiveTabId(child, activePaneId)
    if (activeTabId) return activeTabId
  }
  return null
}

export function resolveProjectIdFromWorkspace(
  layout: PaneLayout,
  activePaneId: string,
  tabs: Map<string, Tab>,
): ProjectId | null {
  const activeTabId = findActiveTabId(layout, activePaneId)
  if (!activeTabId) return null
  return tabs.get(activeTabId)?.projectId ?? null
}

export function resolveWorkbenchProjectId(explicitProjectId?: ProjectId | null): ProjectId | null {
  const projects = useProjectsStore.getState()
  if (explicitProjectId) return explicitProjectId
  if (projects.activeProjectId && projects.projects.has(projects.activeProjectId)) {
    return projects.activeProjectId
  }

  const workspace = useWorkspaceStore.getState()
  const workspaceProjectId = resolveProjectIdFromWorkspace(
    workspace.layout,
    workspace.activePaneId,
    workspace.tabs,
  )
  if (workspaceProjectId && projects.projects.has(workspaceProjectId)) return workspaceProjectId

  const orderedProjects = projects.projectOrder.filter((projectId) => projects.projects.has(projectId))
  if (orderedProjects.length === 1) {
    return orderedProjects[0] ?? null
  }

  return null
}
