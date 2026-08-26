import { beforeEach, describe, expect, it } from 'vitest'
import { useProjectsStore } from '@/stores/projects'

describe('projects store active project selection', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      projects: new Map(),
      projectOrder: [],
      activeProjectId: null,
    })
  })

  it('does not auto-select the first hydrated project', () => {
    useProjectsStore.getState().hydrateProjects([
      {
        id: 'project-1',
        name: 'Alpha',
        path: '/tmp/alpha',
        color: 'blue',
        branch: 'main',
        collapsed: true,
        expandedSections: new Set(),
      },
    ])

    expect(useProjectsStore.getState().activeProjectId).toBeNull()
  })

  it('preserves an explicit active project when it still exists', () => {
    useProjectsStore.setState({ activeProjectId: 'project-2' })

    useProjectsStore.getState().hydrateProjects([
      {
        id: 'project-1',
        name: 'Alpha',
        path: '/tmp/alpha',
        color: 'blue',
        branch: 'main',
        collapsed: true,
        expandedSections: new Set(),
      },
      {
        id: 'project-2',
        name: 'Beta',
        path: '/tmp/beta',
        color: 'green',
        branch: 'main',
        collapsed: true,
        expandedSections: new Set(),
      },
    ])

    expect(useProjectsStore.getState().activeProjectId).toBe('project-2')
  })

  it('places the latest added project at the top of the sidebar order', () => {
    useProjectsStore.getState().addProject({
      id: 'project-1',
      name: 'Alpha',
      path: '/tmp/alpha',
      color: 'blue',
      branch: 'main',
      collapsed: true,
      expandedSections: new Set(),
    })

    useProjectsStore.getState().addProject({
      id: 'project-2',
      name: 'Beta',
      path: '/tmp/beta',
      color: 'green',
      branch: 'main',
      collapsed: true,
      expandedSections: new Set(),
    })

    expect(useProjectsStore.getState().projectOrder).toEqual(['project-2', 'project-1'])
  })

  it('expands a collapsed project when it becomes active', () => {
    useProjectsStore.getState().hydrateProjects([
      {
        id: 'project-1',
        name: 'Alpha',
        path: '/tmp/alpha',
        color: 'blue',
        branch: 'main',
        collapsed: true,
        expandedSections: new Set(),
      },
    ])

    useProjectsStore.getState().setActiveProject('project-1')

    expect(useProjectsStore.getState().activeProjectId).toBe('project-1')
    expect(useProjectsStore.getState().projects.get('project-1')?.collapsed).toBe(false)
  })

  it('keeps project order as a unique list of live projects', () => {
    useProjectsStore.getState().hydrateProjects([
      {
        id: 'project-1',
        name: 'Alpha',
        path: '/tmp/alpha',
        color: 'blue',
        branch: 'main',
        collapsed: true,
        expandedSections: new Set(),
      },
      {
        id: 'project-2',
        name: 'Beta',
        path: '/tmp/beta',
        color: 'green',
        branch: 'main',
        collapsed: true,
        expandedSections: new Set(),
      },
      {
        id: 'project-3',
        name: 'Gamma',
        path: '/tmp/gamma',
        color: 'amber',
        branch: 'main',
        collapsed: true,
        expandedSections: new Set(),
      },
    ])

    useProjectsStore.getState().reorderProjects(['project-2', 'project-missing', 'project-2'])

    expect(useProjectsStore.getState().projectOrder).toEqual(['project-2', 'project-1', 'project-3'])
  })

  it('does not activate an unknown project', () => {
    useProjectsStore.getState().hydrateProjects([
      {
        id: 'project-1',
        name: 'Alpha',
        path: '/tmp/alpha',
        color: 'blue',
        branch: 'main',
        collapsed: false,
        expandedSections: new Set(),
      },
    ])
    useProjectsStore.getState().setActiveProject('project-1')

    useProjectsStore.getState().setActiveProject('project-missing')

    expect(useProjectsStore.getState().activeProjectId).toBe('project-1')
  })
})
