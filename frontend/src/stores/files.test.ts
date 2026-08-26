import { beforeEach, describe, expect, it } from 'vitest'
import { useFilesStore } from '@/stores/files'

describe('files store hydration', () => {
  beforeEach(() => {
    useFilesStore.setState({
      trees: new Map(),
      selectedPath: new Map(),
    })
  })

  it('clears selected files missing from refreshed backend trees', () => {
    useFilesStore.getState().hydrateTree('project-1', [
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
        ],
      },
    ])
    useFilesStore.getState().setSelected('project-1', 'src/main.ts')

    useFilesStore.getState().hydrateTree('project-1', [
      {
        name: 'src',
        path: 'src',
        isDir: true,
        depth: 0,
        expanded: true,
        children: [
          {
            name: 'other.ts',
            path: 'src/other.ts',
            isDir: false,
            depth: 1,
          },
        ],
      },
    ])

    expect(useFilesStore.getState().selectedPath.get('project-1')).toBeNull()
  })

  it('keeps selected files present in refreshed backend trees', () => {
    useFilesStore.getState().setSelected('project-1', 'README.md')

    useFilesStore.getState().hydrateTree('project-1', [
      {
        name: 'README.md',
        path: 'README.md',
        isDir: false,
        depth: 0,
      },
    ])

    expect(useFilesStore.getState().selectedPath.get('project-1')).toBe('README.md')
  })

  it('preserves expanded folders while reconciling selection', () => {
    useFilesStore.getState().hydrateTree('project-1', [
      {
        name: 'src',
        path: 'src',
        isDir: true,
        depth: 0,
        expanded: true,
        children: [
          {
            name: 'components',
            path: 'src/components',
            isDir: true,
            depth: 1,
            expanded: false,
            children: [],
          },
        ],
      },
    ])
    useFilesStore.getState().toggleExpand('project-1', 'src/components')

    useFilesStore.getState().hydrateTree('project-1', [
      {
        name: 'src',
        path: 'src',
        isDir: true,
        depth: 0,
        expanded: true,
        children: [
          {
            name: 'components',
            path: 'src/components',
            isDir: true,
            depth: 1,
            expanded: false,
            children: [],
          },
        ],
      },
    ])

    expect(useFilesStore.getState().trees.get('project-1')?.[0]?.children?.[0]?.expanded).toBe(true)
  })
})
