import { create } from 'zustand'
import type { GitState, ProjectId } from '@/types'

interface GitStoreState {
  gitState: Map<ProjectId, GitState>
  hydrateGitState: (projectId: ProjectId, state: GitState) => void
  setGitState: (projectId: ProjectId, state: GitState) => void
}

export const useGitStore = create<GitStoreState>((set) => ({
  gitState: new Map(),

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
}))
