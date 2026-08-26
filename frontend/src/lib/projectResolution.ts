import { useProjectsStore } from '@/stores/projects'
import { useWorkspaceStore } from '@/stores/workspace'
import type { PaneLayout, ProjectId, Tab } from '@/types'

interface WorkbenchProjectResolutionState {
  activeProjectId: ProjectId | null
  projects: Map<ProjectId, unknown>
  projectOrder: ProjectId[]
  layout: PaneLayout
  activePaneId: string
  tabs: Map<string, Tab>
}

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
  const workspace = useWorkspaceStore.getState()
  return resolveWorkbenchProjectIdFromState({
    activeProjectId: projects.activeProjectId,
    projects: projects.projects,
    projectOrder: projects.projectOrder,
    layout: workspace.layout,
    activePaneId: workspace.activePaneId,
    tabs: workspace.tabs,
  })
}

export function resolveWorkbenchProjectIdFromState(input: WorkbenchProjectResolutionState): ProjectId | null {
  if (input.activeProjectId && input.projects.has(input.activeProjectId)) {
    return input.activeProjectId
  }

  const workspaceProjectId = resolveProjectIdFromWorkspace(
    input.layout,
    input.activePaneId,
    input.tabs,
  )
  if (workspaceProjectId && input.projects.has(workspaceProjectId)) return workspaceProjectId

  const orderedProjects = input.projectOrder.filter((projectId) => input.projects.has(projectId))
  if (orderedProjects.length === 1) {
    return orderedProjects[0] ?? null
  }

  return null
}
