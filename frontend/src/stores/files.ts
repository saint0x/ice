import { create } from 'zustand'
import type { FileEntry, ProjectId } from '@/types'

interface FilesState {
  trees: Map<ProjectId, FileEntry[]>
  selectedPath: Map<ProjectId, string | null>
  removedProjectIds: Set<ProjectId>
  hydrateTree: (projectId: ProjectId, tree: FileEntry[]) => void
  toggleExpand: (projectId: ProjectId, path: string) => void
  setSelected: (projectId: ProjectId, path: string) => void
  removeProjectFiles: (projectId: ProjectId) => void
}

function collectExpanded(entries: FileEntry[], expanded: Set<string>) {
  for (const entry of entries) {
    if (entry.expanded) expanded.add(entry.path)
    if (entry.children) collectExpanded(entry.children, expanded)
  }
}

function collectFilePaths(entries: FileEntry[], paths: Set<string>) {
  for (const entry of entries) {
    if (!entry.isDir) paths.add(entry.path)
    if (entry.children) collectFilePaths(entry.children, paths)
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
  removedProjectIds: new Set(),

  hydrateTree: (projectId, tree) =>
    set((s) => {
      if (s.removedProjectIds.has(projectId)) return s
      const trees = new Map(s.trees)
      const expanded = new Set<string>()
      const existingTree = trees.get(projectId)
      if (existingTree) collectExpanded(existingTree, expanded)
      const hydratedTree = applyExpanded(tree, expanded)
      trees.set(projectId, hydratedTree)
      const selectedPath = new Map(s.selectedPath)
      const currentSelectedPath = selectedPath.get(projectId)
      if (currentSelectedPath) {
        const filePaths = new Set<string>()
        collectFilePaths(hydratedTree, filePaths)
        if (!filePaths.has(currentSelectedPath)) {
          selectedPath.set(projectId, null)
        }
      }
      return { trees, selectedPath }
    }),

  toggleExpand: (projectId, path) =>
    set((s) => {
      if (s.removedProjectIds.has(projectId)) return s
      const trees = new Map(s.trees)
      const tree = trees.get(projectId)
      if (!tree) return s
      trees.set(projectId, toggleInTree(tree, path))
      return { trees }
    }),

  setSelected: (projectId, path) =>
    set((s) => {
      if (s.removedProjectIds.has(projectId)) return s
      const selectedPath = new Map(s.selectedPath)
      selectedPath.set(projectId, path)
      return { selectedPath }
    }),

  removeProjectFiles: (projectId) =>
    set((s) => {
      const trees = new Map(s.trees)
      trees.delete(projectId)
      const selectedPath = new Map(s.selectedPath)
      selectedPath.delete(projectId)
      const removedProjectIds = new Set(s.removedProjectIds)
      removedProjectIds.add(projectId)
      return { trees, selectedPath, removedProjectIds }
    }),
}))
