import { create } from 'zustand'
import type { Project, ProjectId, SidebarSection } from '@/types'

interface ProjectsState {
  projects: Map<ProjectId, Project>
  projectOrder: ProjectId[]
  activeProjectId: ProjectId | null
  removedProjectIds: Set<ProjectId>

  hydrateProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (id: ProjectId) => void
  setActiveProject: (id: ProjectId | null) => void
  reorderProjects: (order: ProjectId[]) => void
  toggleSection: (projectId: ProjectId, section: SidebarSection) => void
  toggleProjectCollapsed: (id: ProjectId) => void
  updateProject: (id: ProjectId, patch: Partial<Project>) => void
}

function normalizeProjectOrder(order: ProjectId[], projects: Map<ProjectId, Project>): ProjectId[] {
  const seen = new Set<ProjectId>()
  const normalized: ProjectId[] = []
  for (const projectId of order) {
    if (!projects.has(projectId) || seen.has(projectId)) continue
    seen.add(projectId)
    normalized.push(projectId)
  }
  for (const projectId of projects.keys()) {
    if (seen.has(projectId)) continue
    normalized.push(projectId)
  }
  return normalized
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: new Map(),
  projectOrder: [],
  activeProjectId: null,
  removedProjectIds: new Set(),

  hydrateProjects: (projects) =>
    set((s) => {
      const nextProjects = new Map<ProjectId, Project>()
      for (const project of projects) {
        if (s.removedProjectIds.has(project.id)) continue
        const existing = s.projects.get(project.id)
        nextProjects.set(project.id, {
          ...project,
          collapsed: existing?.collapsed ?? project.collapsed,
          expandedSections: existing?.expandedSections ?? project.expandedSections,
        })
      }
      const projectOrder = projects
        .map((project) => project.id)
        .filter((projectId) => nextProjects.has(projectId))
      const activeProjectId = s.activeProjectId && nextProjects.has(s.activeProjectId)
        ? s.activeProjectId
        : null
      return { projects: nextProjects, projectOrder, activeProjectId }
    }),

  addProject: (project) =>
    set((s) => {
      const projects = new Map(s.projects)
      projects.set(project.id, project)
      const removedProjectIds = new Set(s.removedProjectIds)
      removedProjectIds.delete(project.id)
      return {
        projects,
        removedProjectIds,
        projectOrder: [project.id, ...s.projectOrder.filter((existingId) => existingId !== project.id)],
      }
    }),

  removeProject: (id) =>
    set((s) => {
      const projects = new Map(s.projects)
      projects.delete(id)
      const projectOrder = s.projectOrder.filter((pid) => pid !== id)
      const activeProjectId = s.activeProjectId === id ? null : s.activeProjectId
      const removedProjectIds = new Set(s.removedProjectIds)
      removedProjectIds.add(id)
      return { projects, projectOrder, activeProjectId, removedProjectIds }
    }),

  setActiveProject: (id) =>
    set((s) => {
      if (!id) {
        return { activeProjectId: null }
      }
      const projects = new Map(s.projects)
      const project = projects.get(id)
      if (!project || s.removedProjectIds.has(id)) return s
      if (project?.collapsed) {
        projects.set(id, { ...project, collapsed: false })
      }
      return { activeProjectId: id, projects }
    }),

  reorderProjects: (order) =>
    set((s) => ({ projectOrder: normalizeProjectOrder(order, s.projects) })),

  toggleProjectCollapsed: (id) =>
    set((s) => {
      const projects = new Map(s.projects)
      const project = projects.get(id)
      if (!project || s.removedProjectIds.has(id)) return s
      projects.set(id, { ...project, collapsed: !project.collapsed })
      return { projects }
    }),

  toggleSection: (projectId, section) =>
    set((s) => {
      const projects = new Map(s.projects)
      const project = projects.get(projectId)
      if (!project || s.removedProjectIds.has(projectId)) return s
      const expanded = new Set(project.expandedSections)
      if (expanded.has(section)) expanded.delete(section)
      else expanded.add(section)
      projects.set(projectId, { ...project, expandedSections: expanded })
      return { projects }
    }),

  updateProject: (id, patch) =>
    set((s) => {
      const projects = new Map(s.projects)
      const project = projects.get(id)
      if (!project || s.removedProjectIds.has(id)) return s
      projects.set(id, { ...project, ...patch })
      return { projects }
    }),
}))
