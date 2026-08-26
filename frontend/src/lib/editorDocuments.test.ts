import { describe, expect, it } from 'vitest'
import { buildProjectPrefetchPlan } from '@/lib/editorDocuments'
import type { FileEntry, Tab } from '@/types'

describe('editor document prefetch planning', () => {
  it('prioritizes open editor tabs and the selected path ahead of the full tree', () => {
    const tree: FileEntry[] = [
      {
        name: 'src',
        path: 'src',
        isDir: true,
        depth: 0,
        expanded: true,
        children: [
          {
            name: 'main.ts',
            path: 'src/main.ts',
            isDir: false,
            depth: 1,
          },
          {
            name: 'app.ts',
            path: 'src/app.ts',
            isDir: false,
            depth: 1,
          },
        ],
      },
      {
        name: 'README.md',
        path: 'README.md',
        isDir: false,
        depth: 0,
      },
    ]

    const openTabs: Tab[] = [
      {
        id: 'tab-1',
        projectId: 'project-a',
        type: 'editor',
        title: 'app.ts',
        meta: { path: 'src/app.ts' },
      },
      {
        id: 'tab-2',
        projectId: 'project-b',
        type: 'editor',
        title: 'other.ts',
        meta: { path: 'other.ts' },
      },
    ]

    expect(
      buildProjectPrefetchPlan({
        projectId: 'project-a',
        tree,
        selectedPath: 'README.md',
        openTabs,
      }),
    ).toEqual([
      'src/app.ts',
      'README.md',
      'src/main.ts',
    ])
  })

  it('bounds prefetch planning to a small visible working set', () => {
    const tree: FileEntry[] = Array.from({ length: 20 }, (_, index) => ({
      name: `file-${index}.ts`,
      path: `src/file-${index}.ts`,
      isDir: false,
      depth: 0,
    }))

    expect(
      buildProjectPrefetchPlan({
        projectId: 'project-a',
        tree,
      }),
    ).toHaveLength(12)
  })
})
