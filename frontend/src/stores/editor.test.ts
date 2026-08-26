import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'

describe('editor cache retention', () => {
  beforeEach(() => {
    useEditorStore.setState({ documents: new Map() })
    useWorkspaceStore.setState({
      layout: {
        id: 'pane-1',
        type: 'leaf',
        tabs: ['tab-1'],
        activeTabId: 'tab-1',
      },
      tabs: new Map([
        ['tab-1', {
          id: 'tab-1',
          projectId: 'project-a',
          type: 'editor',
          title: 'main.ts',
          meta: { path: 'src/main.ts' },
        }],
      ]),
      activePaneId: 'pane-1',
      pendingFocusPaneId: null,
      sidebarOpen: true,
      sidebarWidth: 240,
      bottomDockOpen: true,
      bottomDockHeight: 240,
      chatPanelOpen: false,
      chatPanelWidth: 360,
    })
  })

  it('does not evict an open editor tab while pruning', () => {
    useEditorStore.setState({
      documents: new Map([
        ['project-a:src/main.ts', {
          projectId: 'project-a',
          path: 'src/main.ts',
          content: 'export const a = 1',
          isBinary: false,
          sizeBytes: 18,
          hasBom: false,
          loadedAt: 1,
          lastTouchedAt: 1,
          syntaxMode: 'full',
          isDirty: false,
          isLoading: false,
          isSaving: false,
        }],
        ['project-a:src/old.ts', {
          projectId: 'project-a',
          path: 'src/old.ts',
          content: 'export const old = 1',
          isBinary: false,
          sizeBytes: 20,
          hasBom: false,
          loadedAt: 2,
          lastTouchedAt: 0,
          syntaxMode: 'full',
          isDirty: false,
          isLoading: false,
          isSaving: false,
        }],
      ]),
    })

    useEditorStore.getState().pruneCachedDocuments({ maxDocuments: 1, maxBytes: 10 })

    const documents = useEditorStore.getState().documents
    expect(documents.has('project-a:src/main.ts')).toBe(true)
    expect(documents.has('project-a:src/old.ts')).toBe(false)
  })
})
