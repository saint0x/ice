import { create } from 'zustand'
import type { FileEntry, ProjectId } from '@/types'

interface FilesState {
  trees: Map<ProjectId, FileEntry[]>
  selectedPath: Map<ProjectId, string | null>
  setTree: (projectId: ProjectId, tree: FileEntry[]) => void
  toggleExpand: (projectId: ProjectId, path: string) => void
  setSelected: (projectId: ProjectId, path: string) => void
}

function toggleInTree(entries: FileEntry[], path: string): FileEntry[] {
  return entries.map((e) => {
    if (e.path === path) return { ...e, expanded: !e.expanded }
    if (e.children) return { ...e, children: toggleInTree(e.children, path) }
    return e
  })
}

export const useFilesStore = create<FilesState>((set) => ({
  trees: new Map<ProjectId, FileEntry[]>(),
  selectedPath: new Map(),

  setTree: (projectId, tree) =>
    set((s) => {
      const trees = new Map(s.trees)
      trees.set(projectId, tree)
      return { trees }
    }),

  toggleExpand: (projectId, path) =>
    set((s) => {
      const trees = new Map(s.trees)
      const tree = trees.get(projectId)
      if (!tree) return s
      trees.set(projectId, toggleInTree(tree, path))
      return { trees }
    }),

  setSelected: (projectId, path) =>
    set((s) => {
      const selectedPath = new Map(s.selectedPath)
      selectedPath.set(projectId, path)
      return { selectedPath }
    }),
}))
