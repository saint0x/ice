import { create } from 'zustand'
import type { CodexThread, CodexApproval, ThreadId, ProjectId } from '@/types'

interface CodexState {
  threads: Map<ThreadId, CodexThread>
  approvals: CodexApproval[]
  activeThreadId: Map<ProjectId, ThreadId | null>

  hydrateThreads: (threads: CodexThread[]) => void
  hydrateApprovals: (approvals: CodexApproval[]) => void
  addThread: (thread: CodexThread) => void
  setActiveThread: (projectId: ProjectId, threadId: ThreadId) => void
  updateThread: (threadId: ThreadId, patch: Partial<CodexThread>) => void
  addApproval: (approval: CodexApproval) => void
  resolveApproval: (id: string) => void
}

export const useCodexStore = create<CodexState>((set) => ({
  threads: new Map([
    ['thread-1', {
      id: 'thread-1',
      projectId: 'proj-1',
      title: 'Implement pane grid layout',
      lastMessage: 'I\'ve created the split pane system with drag handles...',
      unread: true,
      status: 'idle' as const,
    }],
    ['thread-2', {
      id: 'thread-2',
      projectId: 'proj-1',
      title: 'Fix terminal resize',
      lastMessage: 'The terminal now resizes correctly when...',
      unread: false,
      status: 'running' as const,
    }],
  ]),
  approvals: [],
  activeThreadId: new Map([['proj-1', 'thread-1']]),

  hydrateThreads: (threads) =>
    set((s) => {
      const nextThreads = new Map<ThreadId, CodexThread>()
      const nextActiveThreadId = new Map(s.activeThreadId)
      for (const thread of threads) {
        nextThreads.set(thread.id, thread)
      }
      const projectIds = new Set<string>(threads.map((thread) => thread.projectId))
      for (const projectId of projectIds) {
        const activeId = nextActiveThreadId.get(projectId)
        const projectThreads = threads.filter((thread) => thread.projectId === projectId)
        if (!activeId || !nextThreads.has(activeId)) {
          nextActiveThreadId.set(projectId, projectThreads[0]?.id ?? null)
        }
      }
      return { threads: nextThreads, activeThreadId: nextActiveThreadId }
    }),

  hydrateApprovals: (approvals) => set({ approvals }),

  addThread: (thread) =>
    set((s) => {
      const threads = new Map(s.threads)
      threads.set(thread.id, thread)
      return { threads }
    }),

  setActiveThread: (projectId, threadId) =>
    set((s) => {
      const activeThreadId = new Map(s.activeThreadId)
      activeThreadId.set(projectId, threadId)
      return { activeThreadId }
    }),

  updateThread: (threadId, patch) =>
    set((s) => {
      const threads = new Map(s.threads)
      const thread = threads.get(threadId)
      if (!thread) return s
      threads.set(threadId, { ...thread, ...patch })
      return { threads }
    }),

  addApproval: (approval) =>
    set((s) => ({ approvals: [...s.approvals, approval] })),

  resolveApproval: (id) =>
    set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) })),
}))
