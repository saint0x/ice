import { create } from 'zustand'
import type { Project, ProjectId, SidebarSection } from '@/types'

interface ProjectsState {
  projects: Map<ProjectId, Project>
  projectOrder: ProjectId[]
  activeProjectId: ProjectId | null

  hydrateProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (id: ProjectId) => void
  setActiveProject: (id: ProjectId) => void
  reorderProjects: (order: ProjectId[]) => void
  toggleSection: (projectId: ProjectId, section: SidebarSection) => void
  toggleProjectCollapsed: (id: ProjectId) => void
  updateProject: (id: ProjectId, patch: Partial<Project>) => void
}

const DEMO_PROJECTS: Project[] = [
  {
    id: 'proj-1',
    name: 'ice',
    path: '/Users/deepsaint/Desktop/ice',
    color: '#7c9bf7',
    branch: 'main',
    collapsed: false,
    expandedSections: new Set(['files'] as SidebarSection[]),
  },
  {
    id: 'proj-2',
    name: 'glass',
    path: '/Users/deepsaint/Desktop/Glass',
    color: '#66bb6a',
    branch: 'dev',
    collapsed: false,
    expandedSections: new Set(['files'] as SidebarSection[]),
  },
]

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: new Map(DEMO_PROJECTS.map((p) => [p.id, p])),
  projectOrder: DEMO_PROJECTS.map((p) => p.id),
  activeProjectId: DEMO_PROJECTS[0]?.id ?? null,

  hydrateProjects: (projects) =>
    set((s) => {
      const nextProjects = new Map<ProjectId, Project>()
      for (const project of projects) {
        const existing = s.projects.get(project.id)
        nextProjects.set(project.id, {
          ...project,
          collapsed: existing?.collapsed ?? project.collapsed,
          expandedSections: existing?.expandedSections ?? project.expandedSections,
        })
      }
      const projectOrder = projects.map((project) => project.id)
      const activeProjectId =
        (s.activeProjectId && nextProjects.has(s.activeProjectId) ? s.activeProjectId : null)
        ?? projectOrder[0]
        ?? null
      return { projects: nextProjects, projectOrder, activeProjectId }
    }),

  addProject: (project) =>
    set((s) => {
      const projects = new Map(s.projects)
      projects.set(project.id, project)
      return { projects, projectOrder: [...s.projectOrder, project.id] }
    }),

  removeProject: (id) =>
    set((s) => {
      const projects = new Map(s.projects)
      projects.delete(id)
      const projectOrder = s.projectOrder.filter((pid) => pid !== id)
      const activeProjectId = s.activeProjectId === id ? projectOrder[0] ?? null : s.activeProjectId
      return { projects, projectOrder, activeProjectId }
    }),

  setActiveProject: (id) => set({ activeProjectId: id }),

  reorderProjects: (order) => set({ projectOrder: order }),

  toggleProjectCollapsed: (id) =>
    set((s) => {
      const projects = new Map(s.projects)
      const project = projects.get(id)
      if (!project) return s
      projects.set(id, { ...project, collapsed: !project.collapsed })
      return { projects }
    }),

  toggleSection: (projectId, section) =>
    set((s) => {
      const projects = new Map(s.projects)
      const project = projects.get(projectId)
      if (!project) return s
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
      if (!project) return s
      projects.set(id, { ...project, ...patch })
      return { projects }
    }),
}))
