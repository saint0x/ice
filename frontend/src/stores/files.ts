import { create } from 'zustand'
import type { FileEntry, ProjectId } from '@/types'

interface FilesState {
  trees: Map<ProjectId, FileEntry[]>
  selectedPath: Map<ProjectId, string | null>
  hydrateTree: (projectId: ProjectId, tree: FileEntry[]) => void
  setTree: (projectId: ProjectId, tree: FileEntry[]) => void
  toggleExpand: (projectId: ProjectId, path: string) => void
  setSelected: (projectId: ProjectId, path: string) => void
}

function collectExpanded(entries: FileEntry[], expanded: Set<string>) {
  for (const entry of entries) {
    if (entry.expanded) expanded.add(entry.path)
    if (entry.children) collectExpanded(entry.children, expanded)
  }
}

function applyExpanded(entries: FileEntry[], expanded: Set<string>): FileEntry[] {
  return entries.map((entry) => ({
    ...entry,
    expanded: entry.isDir ? expanded.has(entry.path) || entry.depth === 0 : entry.expanded,
    children: entry.children ? applyExpanded(entry.children, expanded) : entry.children,
  }))
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

  hydrateTree: (projectId, tree) =>
    set((s) => {
      const trees = new Map(s.trees)
      const expanded = new Set<string>()
      const existingTree = trees.get(projectId)
      if (existingTree) collectExpanded(existingTree, expanded)
      trees.set(projectId, applyExpanded(tree, expanded))
      return { trees }
    }),

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
