import { create } from 'zustand'
import type { CodexThread, CodexApproval, CodexMessage, ProjectCodexSidebarItem, ThreadId, ProjectId } from '@/types'

interface CodexState {
  threads: Map<ThreadId, CodexThread>
  approvals: CodexApproval[]
  activeThreadId: Map<ProjectId, ThreadId | null>
  messagesByThread: Map<ThreadId, CodexMessage[]>
  sidebarItems: Map<ProjectId, ProjectCodexSidebarItem[]>

  hydrateThreads: (threads: CodexThread[]) => void
  hydrateApprovals: (approvals: CodexApproval[]) => void
  hydrateMessages: (threadId: ThreadId, messages: CodexMessage[]) => void
  hydrateSidebarItems: (projectId: ProjectId, items: ProjectCodexSidebarItem[]) => void
  addThread: (thread: CodexThread) => void
  setActiveThread: (projectId: ProjectId, threadId: ThreadId) => void
  updateThread: (threadId: ThreadId, patch: Partial<CodexThread>) => void
  upsertMessage: (message: CodexMessage) => void
  addApproval: (approval: CodexApproval) => void
  resolveApproval: (id: string) => void
  clearUnread: (threadId: ThreadId) => void
}

export const useCodexStore = create<CodexState>((set) => ({
  threads: new Map(),
  approvals: [],
  activeThreadId: new Map(),
  messagesByThread: new Map(),
  sidebarItems: new Map(),

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

  hydrateMessages: (threadId, messages) =>
    set((s) => {
      const messagesByThread = new Map(s.messagesByThread)
      messagesByThread.set(threadId, messages)
      return { messagesByThread }
    }),

  hydrateSidebarItems: (projectId, items) =>
    set((s) => {
      const sidebarItems = new Map(s.sidebarItems)
      sidebarItems.set(projectId, items)
      return { sidebarItems }
    }),

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
      const threads = new Map(s.threads)
      const thread = threads.get(threadId)
      if (thread) {
        threads.set(threadId, { ...thread, unread: false })
      }
      return { activeThreadId, threads }
    }),

  updateThread: (threadId, patch) =>
    set((s) => {
      const threads = new Map(s.threads)
      const thread = threads.get(threadId)
      if (!thread) return s
      threads.set(threadId, { ...thread, ...patch })
      return { threads }
    }),

  upsertMessage: (message) =>
    set((s) => {
      const messagesByThread = new Map(s.messagesByThread)
      const current = messagesByThread.get(message.threadId) ?? []
      const index = current.findIndex((entry) => entry.id === message.id)
      const next = [...current]
      if (index >= 0) {
        next[index] = message
      } else {
        next.push(message)
      }
      next.sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      messagesByThread.set(message.threadId, next)
      return { messagesByThread }
    }),

  addApproval: (approval) =>
    set((s) => ({ approvals: [...s.approvals, approval] })),

  resolveApproval: (id) =>
    set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) })),

  clearUnread: (threadId) =>
    set((s) => {
      const threads = new Map(s.threads)
      const thread = threads.get(threadId)
      if (!thread) return s
      threads.set(threadId, { ...thread, unread: false })
      return { threads }
    }),
}))
