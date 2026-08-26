import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildProjectPrefetchPlan, ensureEditorDocument, readEditorDocumentSnapshot } from '@/lib/editorDocuments'
import { fileRead } from '@/lib/backend'
import { useEditorStore } from '@/stores/editor'
import type { FileEntry, Tab } from '@/types'

vi.mock('@/lib/backend', () => ({
  fileRead: vi.fn(),
}))

describe('editor document prefetch planning', () => {
  beforeEach(() => {
    vi.mocked(fileRead).mockReset()
    useEditorStore.setState({ documents: new Map() })
  })

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

  it('keeps a visible read failure as an explicit non-editable document state', async () => {
    vi.mocked(fileRead).mockRejectedValue(new Error('missing from disk'))

    await expect(ensureEditorDocument('project-a', 'src/missing.ts')).resolves.toBeNull()

    const document = useEditorStore.getState().documents.get('project-a:src/missing.ts')
    expect(document).toMatchObject({
      projectId: 'project-a',
      path: 'src/missing.ts',
      content: '',
      isLoading: false,
      isSaving: false,
      isDirty: false,
      readFailed: true,
      error: 'missing from disk',
    })
  })

  it('drops silent prefetch failures instead of caching fake empty documents', async () => {
    vi.mocked(fileRead).mockRejectedValue(new Error('permission denied'))

    await expect(ensureEditorDocument('project-a', 'src/private.ts', { silent: true })).resolves.toBeNull()

    expect(useEditorStore.getState().documents.has('project-a:src/private.ts')).toBe(false)
  })

  it('retries a document that previously failed to read', async () => {
    vi.mocked(fileRead)
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValueOnce({
        path: 'src/flaky.ts',
        content: 'export const ok = true',
        isBinary: false,
        sizeBytes: 22,
        encoding: 'utf-8',
        hasBom: false,
        modifiedAtMs: 10,
        versionToken: 'v2',
      })

    await expect(ensureEditorDocument('project-a', 'src/flaky.ts')).resolves.toBeNull()
    await expect(ensureEditorDocument('project-a', 'src/flaky.ts')).resolves.toMatchObject({
      content: 'export const ok = true',
      versionToken: 'v2',
    })

    expect(fileRead).toHaveBeenCalledTimes(2)
    const document = useEditorStore.getState().documents.get('project-a:src/flaky.ts')
    expect(document).toMatchObject({
      content: 'export const ok = true',
      isLoading: false,
    })
    expect(document).not.toHaveProperty('readFailed', true)
    expect(document).not.toHaveProperty('error')
  })

  it('reads a disk snapshot without overwriting a dirty editor document', async () => {
    useEditorStore.setState({
      documents: new Map([
        ['project-a:src/conflict.ts', {
          projectId: 'project-a',
          path: 'src/conflict.ts',
          content: 'user edits',
          isBinary: false,
          sizeBytes: 10,
          encoding: 'utf-8',
          hasBom: false,
          modifiedAtMs: 10,
          versionToken: 'v1',
          loadedAt: 1,
          lastTouchedAt: 2,
          syntaxMode: 'full',
          isDirty: true,
          isLoading: false,
          isSaving: true,
        }],
      ]),
    })
    vi.mocked(fileRead).mockResolvedValueOnce({
      path: 'src/conflict.ts',
      content: 'disk edits',
      isBinary: false,
      sizeBytes: 10,
      encoding: 'utf-8',
      hasBom: false,
      modifiedAtMs: 20,
      versionToken: 'v2',
    })

    await expect(readEditorDocumentSnapshot('project-a', 'src/conflict.ts')).resolves.toMatchObject({
      content: 'disk edits',
      versionToken: 'v2',
    })

    expect(useEditorStore.getState().documents.get('project-a:src/conflict.ts')).toMatchObject({
      content: 'user edits',
      versionToken: 'v1',
      isDirty: true,
      isSaving: true,
    })
  })
})
