import { create } from 'zustand'
import type { GitMutationEvent, GitState, ProjectId } from '@/types'

interface GitStoreState {
  gitState: Map<ProjectId, GitState>
  lastMutation: Map<ProjectId, GitMutationEvent>
  hydrateGitState: (projectId: ProjectId, state: GitState) => void
  setGitState: (projectId: ProjectId, state: GitState) => void
  recordMutation: (event: GitMutationEvent) => void
}

export const useGitStore = create<GitStoreState>((set) => ({
  gitState: new Map(),
  lastMutation: new Map(),

  hydrateGitState: (projectId, state) =>
    set((s) => {
      const gitState = new Map(s.gitState)
      gitState.set(projectId, state)
      return { gitState }
    }),

  setGitState: (projectId, state) =>
    set((s) => {
      const gitState = new Map(s.gitState)
      gitState.set(projectId, state)
      return { gitState }
    }),

  recordMutation: (event) =>
    set((s) => {
      const lastMutation = new Map(s.lastMutation)
      lastMutation.set(event.projectId, event)
      return { lastMutation }
    }),
}))
