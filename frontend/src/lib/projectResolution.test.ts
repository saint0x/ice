import { beforeEach, describe, expect, it } from 'vitest'
import { findActiveTabId, resolveProjectIdFromWorkspace, resolveWorkbenchProjectId } from '@/lib/projectResolution'
import { useProjectsStore } from '@/stores/projects'
import { useWorkspaceStore } from '@/stores/workspace'
import type { PaneLayout, Project, Tab } from '@/types'

const splitLayout: PaneLayout = {
  id: 'root',
  type: 'split',
  direction: 'horizontal',
  ratio: 0.5,
  children: [
    {
      id: 'pane-1',
      type: 'leaf',
      tabs: ['tab-a'],
      activeTabId: 'tab-a',
    },
    {
      id: 'pane-2',
      type: 'leaf',
      tabs: ['tab-b', 'tab-c'],
      activeTabId: 'tab-b',
    },
  ],
}

function project(id: string, name = id): Project {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    color: 'blue',
    branch: 'main',
    collapsed: false,
    expandedSections: new Set(['files']),
  }
}

function tab(id: string, projectId: string): Tab {
  return {
    id,
    projectId,
    type: 'editor',
    title: id,
    meta: { path: `${id}.ts` },
  }
}

describe('project resolution', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      projects: new Map(),
      projectOrder: [],
      activeProjectId: null,
    })
    useWorkspaceStore.setState({
      layout: splitLayout,
      tabs: new Map(),
      activePaneId: 'pane-1',
    })
  })

  it('returns the active tab from the active pane in split layouts', () => {
    expect(findActiveTabId(splitLayout, 'pane-2')).toBe('tab-b')
  })

  it('returns null when the active pane does not exist', () => {
    const layout: PaneLayout = {
      id: 'pane-1',
      type: 'leaf',
      tabs: ['tab-a'],
      activeTabId: 'tab-a',
    }

    expect(findActiveTabId(layout, 'pane-missing')).toBeNull()
  })

  it('resolves a project from the active workspace tab', () => {
    const tabs = new Map([
      ['tab-a', tab('tab-a', 'project-1')],
      ['tab-b', tab('tab-b', 'project-2')],
    ])

    expect(resolveProjectIdFromWorkspace(splitLayout, 'pane-2', tabs)).toBe('project-2')
  })

  it('prefers an explicit project over workspace and singleton fallbacks', () => {
    useProjectsStore.setState({
      projects: new Map([
        ['project-1', project('project-1')],
        ['project-2', project('project-2')],
      ]),
      projectOrder: ['project-1', 'project-2'],
      activeProjectId: null,
    })
    useWorkspaceStore.setState({
      layout: splitLayout,
      tabs: new Map([
        ['tab-a', tab('tab-a', 'project-1')],
        ['tab-b', tab('tab-b', 'project-1')],
      ]),
      activePaneId: 'pane-1',
    })

    expect(resolveWorkbenchProjectId('project-2')).toBe('project-2')
  })

  it('accepts an explicit project before project hydration completes', () => {
    expect(resolveWorkbenchProjectId('project-1')).toBe('project-1')
  })

  it('uses the active workspace tab project when the store has no active project', () => {
    useProjectsStore.setState({
      projects: new Map([
        ['project-1', project('project-1')],
        ['project-2', project('project-2')],
      ]),
      projectOrder: ['project-1', 'project-2'],
      activeProjectId: null,
    })
    useWorkspaceStore.setState({
      layout: splitLayout,
      tabs: new Map([
        ['tab-a', tab('tab-a', 'project-1')],
        ['tab-b', tab('tab-b', 'project-2')],
      ]),
      activePaneId: 'pane-2',
    })

    expect(resolveWorkbenchProjectId()).toBe('project-2')
  })

  it('uses the only live project when there is no workspace signal', () => {
    useProjectsStore.setState({
      projects: new Map([['project-1', project('project-1')]]),
      projectOrder: ['missing-project', 'project-1'],
      activeProjectId: null,
    })

    expect(resolveWorkbenchProjectId()).toBe('project-1')
  })

  it('does not resolve stale inferred project ids', () => {
    useProjectsStore.setState({
      projects: new Map([['project-1', project('project-1')]]),
      projectOrder: ['project-1'],
      activeProjectId: 'missing-project',
    })
    useWorkspaceStore.setState({
      layout: splitLayout,
      tabs: new Map([['tab-a', tab('tab-a', 'missing-project')]]),
      activePaneId: 'pane-1',
    })

    expect(resolveWorkbenchProjectId()).toBe('project-1')
  })
})
