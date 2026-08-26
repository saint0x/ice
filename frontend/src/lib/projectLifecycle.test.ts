import { beforeEach, describe, expect, it } from 'vitest'
import { removeProjectLocalState } from '@/lib/projectLifecycle'
import { useBrowserStore } from '@/stores/browser'
import { useCodexStore } from '@/stores/codex'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useGitStore } from '@/stores/git'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'

function resetStores() {
  useProjectsStore.setState({
    projects: new Map([
      ['project-1', {
        id: 'project-1',
        name: 'Alpha',
        path: '/tmp/alpha',
        color: 'blue',
        branch: 'main',
        collapsed: false,
        expandedSections: new Set(['files']),
      }],
      ['project-2', {
        id: 'project-2',
        name: 'Beta',
        path: '/tmp/beta',
        color: 'green',
        branch: 'main',
        collapsed: false,
        expandedSections: new Set(['files']),
      }],
    ]),
    projectOrder: ['project-1', 'project-2'],
    activeProjectId: 'project-1',
  })

  useWorkspaceStore.setState({
    layout: {
      id: 'split-1',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [
        {
          id: 'pane-1',
          type: 'leaf',
          tabs: ['tab-1', 'tab-2'],
          activeTabId: 'tab-2',
        },
        {
          id: 'pane-2',
          type: 'leaf',
          tabs: ['tab-3'],
          activeTabId: 'tab-3',
        },
      ],
    },
    tabs: new Map([
      ['tab-1', { id: 'tab-1', projectId: 'project-1', type: 'editor', title: 'old.ts', meta: { path: 'old.ts' } }],
      ['tab-2', { id: 'tab-2', projectId: 'project-2', type: 'editor', title: 'keep.ts', meta: { path: 'keep.ts' } }],
      ['tab-3', { id: 'tab-3', projectId: 'project-1', type: 'terminal', title: 'Alpha shell', meta: { sessionId: 'terminal-1' } }],
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

  useFilesStore.setState({
    trees: new Map([
      ['project-1', []],
      ['project-2', []],
    ]),
    selectedPath: new Map([
      ['project-1', 'old.ts'],
      ['project-2', 'keep.ts'],
    ]),
  })

  useGitStore.setState({
    gitState: new Map([
      ['project-1', { branch: 'main', ahead: 0, behind: 0, changes: [] }],
      ['project-2', { branch: 'main', ahead: 0, behind: 0, changes: [] }],
    ]),
    lastMutation: new Map(),
  })

  useBrowserStore.setState({
    tabs: new Map([
      ['browser-1', {
        id: 'browser-1',
        projectId: 'project-1',
        title: 'Alpha',
        url: 'https://example.com/a',
        isPinned: false,
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        isSecure: true,
      }],
      ['browser-2', {
        id: 'browser-2',
        projectId: 'project-2',
        title: 'Beta',
        url: 'https://example.com/b',
        isPinned: false,
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        isSecure: true,
      }],
    ]),
    activeTabId: new Map([
      ['project-1', 'browser-1'],
      ['project-2', 'browser-2'],
    ]),
    sidebarItems: new Map([
      ['project-1', [{ tabId: 'browser-1', title: 'Alpha', url: 'https://example.com/a', isPinned: false, isLoading: false, isSecure: true }]],
      ['project-2', [{ tabId: 'browser-2', title: 'Beta', url: 'https://example.com/b', isPinned: false, isLoading: false, isSecure: true }]],
    ]),
    runtimeNotices: new Map([
      ['browser-1', []],
      ['browser-2', []],
    ]),
  })

  useTerminalStore.setState({
    sessions: new Map([
      ['terminal-1', {
        id: 'terminal-1',
        projectId: 'project-1',
        title: 'Alpha shell',
        cwd: '/tmp/alpha',
        isRunning: true,
      }],
      ['terminal-2', {
        id: 'terminal-2',
        projectId: 'project-2',
        title: 'Beta shell',
        cwd: '/tmp/beta',
        isRunning: true,
      }],
    ]),
    activeSessionId: new Map([
      ['project-1', 'terminal-1'],
      ['project-2', 'terminal-2'],
    ]),
    scrollback: new Map([
      ['terminal-1', 'alpha'],
      ['terminal-2', 'beta'],
    ]),
    diagnostics: new Map(),
  })

  useCodexStore.setState({
    threads: new Map([
      ['thread-1', {
        id: 'thread-1',
        projectId: 'project-1',
        title: 'Alpha thread',
        unread: true,
        status: 'idle',
      }],
      ['thread-2', {
        id: 'thread-2',
        projectId: 'project-2',
        title: 'Beta thread',
        unread: false,
        status: 'idle',
      }],
    ]),
    approvals: [
      {
        id: 'approval-1',
        projectId: 'project-1',
        threadId: 'thread-1',
        actionType: 'exec',
        category: 'shell',
        riskLevel: 'low',
        policyAction: 'prompt',
        description: 'alpha',
      },
      {
        id: 'approval-2',
        projectId: 'project-2',
        threadId: 'thread-2',
        actionType: 'exec',
        category: 'shell',
        riskLevel: 'low',
        policyAction: 'prompt',
        description: 'beta',
      },
    ],
    activeThreadId: new Map([
      ['project-1', 'thread-1'],
      ['project-2', 'thread-2'],
    ]),
    messagesByThread: new Map([
      ['thread-1', [{
        id: 'message-1',
        projectId: 'project-1',
        threadId: 'thread-1',
        role: 'assistant',
        content: 'alpha',
        state: 'complete',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      ],
      ['thread-2', []],
    ]),
    sidebarItems: new Map([
      ['project-1', [{ threadId: 'thread-1', title: 'Alpha thread', status: 'idle', unread: true }]],
      ['project-2', [{ threadId: 'thread-2', title: 'Beta thread', status: 'idle', unread: false }]],
    ]),
  })

  useEditorStore.setState({
    documents: new Map([
      ['project-1:old.ts', {
        projectId: 'project-1',
        path: 'old.ts',
        content: 'old',
        isBinary: false,
        sizeBytes: 3,
        hasBom: false,
        loadedAt: 1,
        lastTouchedAt: 1,
        syntaxMode: 'full',
        isDirty: false,
        isLoading: false,
        isSaving: false,
      }],
      ['project-2:keep.ts', {
        projectId: 'project-2',
        path: 'keep.ts',
        content: 'keep',
        isBinary: false,
        sizeBytes: 4,
        hasBom: false,
        loadedAt: 1,
        lastTouchedAt: 1,
        syntaxMode: 'full',
        isDirty: false,
        isLoading: false,
        isSaving: false,
      }],
    ]),
  })
}

describe('project lifecycle cleanup', () => {
  beforeEach(() => {
    resetStores()
  })

  it('removes all frontend state owned by a removed project without touching another project', () => {
    removeProjectLocalState('project-1')

    expect(useProjectsStore.getState().projects.has('project-1')).toBe(false)
    expect(useProjectsStore.getState().projectOrder).toEqual(['project-2'])
    expect(useProjectsStore.getState().activeProjectId).toBeNull()

    expect([...useWorkspaceStore.getState().tabs.values()].map((tab) => tab.projectId)).toEqual(['project-2'])
    expect(useFilesStore.getState().trees.has('project-1')).toBe(false)
    expect(useFilesStore.getState().selectedPath.has('project-1')).toBe(false)
    expect(useGitStore.getState().gitState.has('project-1')).toBe(false)

    expect(useBrowserStore.getState().tabs.has('browser-1')).toBe(false)
    expect(useBrowserStore.getState().tabs.has('browser-2')).toBe(true)
    expect(useBrowserStore.getState().activeTabId.has('project-1')).toBe(false)
    expect(useBrowserStore.getState().sidebarItems.has('project-1')).toBe(false)
    expect(useBrowserStore.getState().closedTabIds.has('browser-1')).toBe(true)

    expect(useTerminalStore.getState().sessions.has('terminal-1')).toBe(false)
    expect(useTerminalStore.getState().sessions.has('terminal-2')).toBe(true)
    expect(useTerminalStore.getState().activeSessionId.has('project-1')).toBe(false)
    expect(useTerminalStore.getState().scrollback.has('terminal-1')).toBe(false)
    expect(useTerminalStore.getState().closedSessionIds.has('terminal-1')).toBe(true)

    expect(useCodexStore.getState().threads.has('thread-1')).toBe(false)
    expect(useCodexStore.getState().threads.has('thread-2')).toBe(true)
    expect(useCodexStore.getState().messagesByThread.has('thread-1')).toBe(false)
    expect(useCodexStore.getState().activeThreadId.has('project-1')).toBe(false)
    expect(useCodexStore.getState().approvals.map((approval) => approval.id)).toEqual(['approval-2'])

    expect(useEditorStore.getState().documents.has('project-1:old.ts')).toBe(false)
    expect(useEditorStore.getState().documents.has('project-2:keep.ts')).toBe(true)
  })

  it('does not resurrect removed project browser tabs or terminals from late backend events', () => {
    removeProjectLocalState('project-1')

    useBrowserStore.getState().upsertTab({
      id: 'browser-1',
      projectId: 'project-1',
      title: 'Late Alpha',
      url: 'https://example.com/late',
      isPinned: false,
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      isSecure: true,
    })
    useTerminalStore.getState().upsertSession({
      id: 'terminal-1',
      projectId: 'project-1',
      title: 'Late Alpha shell',
      cwd: '/tmp/alpha',
      isRunning: false,
    })

    expect(useBrowserStore.getState().tabs.has('browser-1')).toBe(false)
    expect(useTerminalStore.getState().sessions.has('terminal-1')).toBe(false)
  })
})
