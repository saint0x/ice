import { beforeEach, describe, expect, it } from 'vitest'
import { useCodexStore } from '@/stores/codex'
import { useWorkspaceStore } from '@/stores/workspace'

describe('codex store reconciliation', () => {
  beforeEach(() => {
    useCodexStore.setState({
      threads: new Map(),
      approvals: [],
      activeThreadId: new Map(),
      messagesByThread: new Map(),
      sidebarItems: new Map(),
    })
    useWorkspaceStore.setState({
      layout: {
        id: 'pane-1',
        type: 'leaf',
        tabs: [],
        activeTabId: null,
      },
      tabs: new Map(),
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

  it('completes streaming messages when a thread becomes idle', () => {
    useCodexStore.getState().hydrateThreads([
      {
        id: 'thread-1',
        projectId: 'project-a',
        title: 'Thread',
        unread: false,
        status: 'running',
      },
    ])

    useCodexStore.getState().hydrateMessages('thread-1', [
      {
        id: 'message-1',
        threadId: 'thread-1',
        projectId: 'project-a',
        role: 'assistant',
        content: 'partial',
        state: 'streaming',
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    ])

    useCodexStore.getState().updateThread('thread-1', { status: 'idle' })

    expect(useCodexStore.getState().messagesByThread.get('thread-1')?.[0]?.state).toBe('complete')
  })

  it('hydrates streaming messages as complete for already-terminal threads', () => {
    useCodexStore.getState().hydrateThreads([
      {
        id: 'thread-1',
        projectId: 'project-a',
        title: 'Thread',
        unread: false,
        status: 'disconnected',
      },
    ])

    useCodexStore.getState().hydrateMessages('thread-1', [
      {
        id: 'message-1',
        threadId: 'thread-1',
        projectId: 'project-a',
        role: 'assistant',
        content: 'partial',
        state: 'streaming',
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    ])

    expect(useCodexStore.getState().messagesByThread.get('thread-1')?.[0]?.state).toBe('complete')
  })

  it('evicts old inactive message caches while preserving the active thread', () => {
    useCodexStore.getState().hydrateThreads(
      Array.from({ length: 26 }, (_, index) => ({
        id: `thread-${index + 1}`,
        projectId: 'project-a',
        title: `Thread ${index + 1}`,
        unread: false,
        status: 'idle' as const,
      })),
    )
    useCodexStore.getState().setActiveThread('project-a', 'thread-26')

    for (let index = 0; index < 26; index += 1) {
      useCodexStore.getState().hydrateMessages(`thread-${index + 1}`, [
        {
          id: `message-${index + 1}`,
          threadId: `thread-${index + 1}`,
          projectId: 'project-a',
          role: 'assistant',
          content: `payload-${index + 1}`,
          state: 'complete',
          createdAt: `2026-05-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
          updatedAt: `2026-05-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
        },
      ])
    }

    const cached = useCodexStore.getState().messagesByThread
    expect(cached.size).toBeLessThanOrEqual(24)
    expect(cached.has('thread-26')).toBe(true)
  })

  it('prefers a healthy thread over a disconnected thread when choosing the active project thread', () => {
    useCodexStore.getState().hydrateThreads([
      {
        id: 'thread-disconnected',
        projectId: 'project-a',
        title: 'Disconnected',
        unread: false,
        status: 'disconnected',
      },
      {
        id: 'thread-idle',
        projectId: 'project-a',
        title: 'Idle',
        unread: false,
        status: 'idle',
      },
    ])

    expect(useCodexStore.getState().activeThreadId.get('project-a')).toBe('thread-idle')
  })

  it('replaces a disconnected active thread with a healthy one during hydration', () => {
    useCodexStore.setState({
      activeThreadId: new Map([['project-a', 'thread-disconnected']]),
    })

    useCodexStore.getState().hydrateThreads([
      {
        id: 'thread-disconnected',
        projectId: 'project-a',
        title: 'Disconnected',
        unread: false,
        status: 'disconnected',
      },
      {
        id: 'thread-running',
        projectId: 'project-a',
        title: 'Running',
        unread: false,
        status: 'running',
      },
    ])

    expect(useCodexStore.getState().activeThreadId.get('project-a')).toBe('thread-running')
  })

  it('merges lazy history hydration with newer live Codex messages', () => {
    useCodexStore.getState().hydrateThreads([
      {
        id: 'thread-1',
        projectId: 'project-a',
        title: 'Thread',
        unread: false,
        status: 'running',
      },
    ])

    useCodexStore.getState().upsertMessage({
      id: 'thread-1:turn-1:user',
      threadId: 'thread-1',
      projectId: 'project-a',
      turnId: 'turn-1',
      role: 'user',
      content: 'Ship it',
      state: 'complete',
      createdAt: '2026-05-16T20:00:00Z',
      updatedAt: '2026-05-16T20:00:00Z',
    })

    useCodexStore.getState().upsertMessage({
      id: 'thread-1:turn-1:assistant',
      threadId: 'thread-1',
      projectId: 'project-a',
      turnId: 'turn-1',
      role: 'assistant',
      content: 'Working on it now',
      state: 'streaming',
      createdAt: '2026-05-16T20:00:01Z',
      updatedAt: '2026-05-16T20:00:03Z',
    })

    useCodexStore.getState().hydrateMessages('thread-1', [
      {
        id: 'thread-1:turn-1:user',
        threadId: 'thread-1',
        projectId: 'project-a',
        turnId: 'turn-1',
        role: 'user',
        content: 'Ship it',
        state: 'complete',
        createdAt: '2026-05-16T20:00:00Z',
        updatedAt: '2026-05-16T20:00:00Z',
      },
    ])

    const messages = useCodexStore.getState().messagesByThread.get('thread-1')
    expect(messages).toHaveLength(2)
    expect(messages?.[1]?.role).toBe('assistant')
    expect(messages?.[1]?.content).toBe('Working on it now')
    expect(messages?.[1]?.state).toBe('streaming')
  })

  it('does not let older hydration snapshots overwrite finalized assistant content', () => {
    useCodexStore.getState().hydrateThreads([
      {
        id: 'thread-1',
        projectId: 'project-a',
        title: 'Thread',
        unread: false,
        status: 'idle',
      },
    ])

    useCodexStore.getState().upsertMessage({
      id: 'thread-1:turn-1:assistant',
      threadId: 'thread-1',
      projectId: 'project-a',
      turnId: 'turn-1',
      role: 'assistant',
      content: 'Final answer',
      state: 'complete',
      createdAt: '2026-05-16T20:00:01Z',
      updatedAt: '2026-05-16T20:00:05Z',
    })

    useCodexStore.getState().hydrateMessages('thread-1', [
      {
        id: 'thread-1:turn-1:assistant',
        threadId: 'thread-1',
        projectId: 'project-a',
        turnId: 'turn-1',
        role: 'assistant',
        content: 'Partial',
        state: 'streaming',
        createdAt: '2026-05-16T20:00:01Z',
        updatedAt: '2026-05-16T20:00:02Z',
      },
    ])

    const assistant = useCodexStore.getState().messagesByThread.get('thread-1')?.[0]
    expect(assistant?.content).toBe('Final answer')
    expect(assistant?.state).toBe('complete')
  })

  it('drops cached messages for threads missing from backend hydration', () => {
    useCodexStore.setState({
      activeThreadId: new Map([['project-a', 'thread-stale']]),
      messagesByThread: new Map([
        ['thread-stale', [{
          id: 'message-stale',
          threadId: 'thread-stale',
          projectId: 'project-a',
          role: 'assistant',
          content: 'stale',
          state: 'complete',
          createdAt: '2026-05-01T00:00:00Z',
          updatedAt: '2026-05-01T00:00:00Z',
        }]],
      ]),
    })

    useCodexStore.getState().hydrateThreads([])

    expect(useCodexStore.getState().activeThreadId.get('project-a')).toBeNull()
    expect(useCodexStore.getState().messagesByThread.has('thread-stale')).toBe(false)
  })

  it('ignores attempts to activate missing or cross-project Codex threads', () => {
    useCodexStore.getState().hydrateThreads([
      {
        id: 'thread-live',
        projectId: 'project-a',
        title: 'Live',
        unread: true,
        status: 'idle',
      },
      {
        id: 'thread-other',
        projectId: 'project-b',
        title: 'Other',
        unread: true,
        status: 'running',
      },
    ])
    useCodexStore.getState().setActiveThread('project-a', 'thread-live')

    useCodexStore.getState().setActiveThread('project-a', 'thread-missing')
    expect(useCodexStore.getState().activeThreadId.get('project-a')).toBe('thread-live')

    useCodexStore.getState().setActiveThread('project-a', 'thread-other')
    expect(useCodexStore.getState().activeThreadId.get('project-a')).toBe('thread-live')
  })

  it('falls back to the preferred project thread when the stored active Codex thread is stale', () => {
    useCodexStore.setState({
      threads: new Map([
        ['thread-idle', {
          id: 'thread-idle',
          projectId: 'project-a',
          title: 'Idle',
          unread: true,
          status: 'idle',
        }],
        ['thread-running', {
          id: 'thread-running',
          projectId: 'project-a',
          title: 'Running',
          unread: true,
          status: 'running',
        }],
      ]),
      activeThreadId: new Map([['project-a', 'thread-stale']]),
    })

    useCodexStore.getState().setActiveThread('project-a', 'thread-missing')

    expect(useCodexStore.getState().activeThreadId.get('project-a')).toBe('thread-running')
  })
})
