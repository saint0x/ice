import { create } from 'zustand'
import type { GitState, ProjectId } from '@/types'

interface GitStoreState {
  gitState: Map<ProjectId, GitState>
  hydrateGitState: (projectId: ProjectId, state: GitState) => void
  setGitState: (projectId: ProjectId, state: GitState) => void
}

export const useGitStore = create<GitStoreState>((set) => ({
  gitState: new Map([
    ['proj-1', {
      branch: 'main',
      ahead: 2,
      behind: 0,
      changes: [
        { path: 'src/components/Sidebar.tsx', status: 'modified', staged: true },
        { path: 'src/components/PaneGrid.tsx', status: 'added', staged: true },
        { path: 'vite.config.ts', status: 'modified', staged: false },
        { path: 'src/App.tsx', status: 'modified', staged: false },
      ],
    }],
    ['proj-2', {
      branch: 'dev',
      ahead: 0,
      behind: 1,
      changes: [
        { path: 'crates/workspace/src/lib.rs', status: 'modified', staged: false },
      ],
    }],
  ]),

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
