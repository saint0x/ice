import { create } from 'zustand'
import type { GitMutationEvent, GitState, ProjectId } from '@/types'

interface GitStoreState {
  gitState: Map<ProjectId, GitState>
  lastMutation: Map<ProjectId, GitMutationEvent>
  removedProjectIds: Set<ProjectId>
  hydrateGitState: (projectId: ProjectId, state: GitState) => void
  setGitState: (projectId: ProjectId, state: GitState) => void
  recordMutation: (event: GitMutationEvent) => void
  removeProjectGitState: (projectId: ProjectId) => void
}

export const useGitStore = create<GitStoreState>((set) => ({
  gitState: new Map(),
  lastMutation: new Map(),
  removedProjectIds: new Set(),

  hydrateGitState: (projectId, state) =>
    set((s) => {
      if (s.removedProjectIds.has(projectId)) return s
      const gitState = new Map(s.gitState)
      gitState.set(projectId, state)
      return { gitState }
    }),

  setGitState: (projectId, state) =>
    set((s) => {
      if (s.removedProjectIds.has(projectId)) return s
      const gitState = new Map(s.gitState)
      gitState.set(projectId, state)
      return { gitState }
    }),

  recordMutation: (event) =>
    set((s) => {
      if (s.removedProjectIds.has(event.projectId)) return s
      const lastMutation = new Map(s.lastMutation)
      lastMutation.set(event.projectId, event)
      return { lastMutation }
    }),

  removeProjectGitState: (projectId) =>
    set((s) => {
      const gitState = new Map(s.gitState)
      gitState.delete(projectId)
      const lastMutation = new Map(s.lastMutation)
      lastMutation.delete(projectId)
      const removedProjectIds = new Set(s.removedProjectIds)
      removedProjectIds.add(projectId)
      return { gitState, lastMutation, removedProjectIds }
    }),
}))
