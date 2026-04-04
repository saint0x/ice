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

const DEMO_TREE: FileEntry[] = [
  {
    name: 'src', path: 'src', isDir: true, depth: 0, expanded: true, children: [
      {
        name: 'components', path: 'src/components', isDir: true, depth: 1, expanded: true, children: [
          { name: 'AppShell.tsx', path: 'src/components/AppShell.tsx', isDir: false, depth: 2 },
          { name: 'Sidebar.tsx', path: 'src/components/Sidebar.tsx', isDir: false, depth: 2, gitStatus: 'modified' },
          { name: 'PaneGrid.tsx', path: 'src/components/PaneGrid.tsx', isDir: false, depth: 2, gitStatus: 'added' },
        ]
      },
      {
        name: 'stores', path: 'src/stores', isDir: true, depth: 1, children: [
          { name: 'workspace.ts', path: 'src/stores/workspace.ts', isDir: false, depth: 2 },
          { name: 'projects.ts', path: 'src/stores/projects.ts', isDir: false, depth: 2 },
        ]
      },
      { name: 'main.tsx', path: 'src/main.tsx', isDir: false, depth: 1 },
      { name: 'App.tsx', path: 'src/App.tsx', isDir: false, depth: 1, gitStatus: 'modified' },
    ]
  },
  {
    name: 'src-tauri', path: 'src-tauri', isDir: true, depth: 0, children: [
      { name: 'main.rs', path: 'src-tauri/main.rs', isDir: false, depth: 1 },
      { name: 'Cargo.toml', path: 'src-tauri/Cargo.toml', isDir: false, depth: 1 },
    ]
  },
  { name: 'package.json', path: 'package.json', isDir: false, depth: 0 },
  { name: 'tsconfig.json', path: 'tsconfig.json', isDir: false, depth: 0 },
  { name: 'vite.config.ts', path: 'vite.config.ts', isDir: false, depth: 0, gitStatus: 'modified' },
]

export const useFilesStore = create<FilesState>((set) => ({
  trees: new Map([['proj-1', DEMO_TREE]]),
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
