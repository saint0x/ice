import { beforeEach, describe, expect, it } from 'vitest'
import { useGitStore } from '@/stores/git'

describe('git store project lifecycle', () => {
  beforeEach(() => {
    useGitStore.setState({
      gitState: new Map(),
      lastMutation: new Map(),
      removedProjectIds: new Set(),
    })
  })

  it('does not rehydrate git state for a removed project', () => {
    useGitStore.getState().hydrateGitState('project-1', {
      branch: 'main',
      ahead: 0,
      behind: 0,
      changes: [],
    })
    useGitStore.getState().recordMutation({
      type: 'mutationCompleted',
      projectId: 'project-1',
      action: 'fetch',
      summary: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        changes: [],
      },
      context: {},
      receivedAt: '2026-08-26T00:00:00.000Z',
    })

    useGitStore.getState().removeProjectGitState('project-1')
    useGitStore.getState().hydrateGitState('project-1', {
      branch: 'late',
      ahead: 1,
      behind: 0,
      changes: [],
    })
    useGitStore.getState().recordMutation({
      type: 'mutationCompleted',
      projectId: 'project-1',
      action: 'pull',
      summary: {
        branch: 'late',
        ahead: 1,
        behind: 0,
        changes: [],
      },
      context: {},
      receivedAt: '2026-08-26T00:00:01.000Z',
    })

    expect(useGitStore.getState().gitState.has('project-1')).toBe(false)
    expect(useGitStore.getState().lastMutation.has('project-1')).toBe(false)
  })
})
