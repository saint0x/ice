import { create } from 'zustand'
import type { CodexThread, CodexApproval, CodexMessage, ProjectCodexSidebarItem, ThreadId, ProjectId } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace'

const TERMINAL_THREAD_STATUSES = new Set<CodexThread['status']>(['idle', 'error', 'disconnected'])
const MAX_CACHED_THREAD_MESSAGES = 24
const MAX_CACHED_MESSAGE_BYTES = 8 * 1024 * 1024

function threadStatusPreference(status: CodexThread['status']) {
  switch (status) {
    case 'running':
      return 0
    case 'waitingApproval':
    case 'waiting_approval':
      return 1
    case 'idle':
      return 2
    case 'error':
      return 3
    case 'disconnected':
      return 4
    default:
      return 5
  }
}

function choosePreferredThread(projectThreads: CodexThread[]) {
  if (projectThreads.length === 0) return null
  return [...projectThreads].sort((left, right) => (
    threadStatusPreference(left.status) - threadStatusPreference(right.status)
  ))[0] ?? null
}

function compareIsoTimestamps(left: string, right: string) {
  return left.localeCompare(right)
}

function mergeMessage(existing: CodexMessage | undefined, incoming: CodexMessage): CodexMessage {
  if (!existing) {
    return incoming
  }

  const updatedAtOrder = compareIsoTimestamps(existing.updatedAt, incoming.updatedAt)
  if (updatedAtOrder > 0) {
    return existing
  }
  if (updatedAtOrder < 0) {
    return incoming
  }

  if (existing.state === 'complete' && incoming.state === 'streaming') {
    return existing
  }
  if (incoming.state === 'complete' && existing.state === 'streaming') {
    return incoming
  }

  if (existing.content.length > incoming.content.length) {
    return existing
  }
  if (incoming.content.length > existing.content.length) {
    return incoming
  }

  return incoming
}

function mergeThreadMessages(
  threads: Map<ThreadId, CodexThread>,
  current: CodexMessage[],
  incoming: CodexMessage[],
): CodexMessage[] {
  const merged = new Map<string, CodexMessage>()
  for (const message of current) {
    merged.set(message.id, reconcileMessageState(threads, message))
  }
  for (const message of incoming) {
    const normalized = reconcileMessageState(threads, message)
    merged.set(message.id, mergeMessage(merged.get(message.id), normalized))
  }
  return Array.from(merged.values()).sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )
}

function reconcileThreadMessages(
  messagesByThread: Map<ThreadId, CodexMessage[]>,
  threadId: ThreadId,
  status: CodexThread['status'],
) {
  if (!TERMINAL_THREAD_STATUSES.has(status)) {
    return messagesByThread
  }
  const current = messagesByThread.get(threadId)
  if (!current?.some((message) => message.state === 'streaming')) {
    return messagesByThread
  }
  const nextMessages = current.map((message) => (
    message.state === 'streaming'
      ? { ...message, state: 'complete' as const }
      : message
  ))
  const next = new Map(messagesByThread)
  next.set(threadId, nextMessages)
  return next
}

function reconcileMessageState(
  threads: Map<ThreadId, CodexThread>,
  message: CodexMessage,
): CodexMessage {
  const thread = threads.get(message.threadId)
  if (!thread || !TERMINAL_THREAD_STATUSES.has(thread.status) || message.state !== 'streaming') {
    return message
  }
  return { ...message, state: 'complete' }
}

function protectedThreadIds(activeThreadId: Map<ProjectId, ThreadId | null>) {
  const protectedIds = new Set<ThreadId>()
  for (const threadId of activeThreadId.values()) {
    if (threadId) {
      protectedIds.add(threadId)
    }
  }
  for (const tab of useWorkspaceStore.getState().tabs.values()) {
    if (tab.type !== 'codex') continue
    const threadId = typeof tab.meta?.threadId === 'string' ? tab.meta.threadId : null
    if (threadId) {
      protectedIds.add(threadId)
    }
  }
  return protectedIds
}

function totalMessageBytes(messagesByThread: Map<ThreadId, CodexMessage[]>) {
  let total = 0
  for (const messages of messagesByThread.values()) {
    for (const message of messages) {
      total += message.content.length
    }
  }
  return total
}

function latestMessageStamp(messages: CodexMessage[]) {
  return messages[messages.length - 1]?.updatedAt ?? messages[messages.length - 1]?.createdAt ?? ''
}

function pruneMessagesByThread(
  messagesByThread: Map<ThreadId, CodexMessage[]>,
  activeThreadId: Map<ProjectId, ThreadId | null>,
): Map<ThreadId, CodexMessage[]> {
  let totalBytes = totalMessageBytes(messagesByThread)
  if (messagesByThread.size <= MAX_CACHED_THREAD_MESSAGES && totalBytes <= MAX_CACHED_MESSAGE_BYTES) {
    return messagesByThread
  }

  const protectedIds = protectedThreadIds(activeThreadId)
  const evictable = Array.from(messagesByThread.entries())
    .filter(([threadId, messages]) => {
      if (protectedIds.has(threadId)) return false
      return !messages.some((message) => message.state === 'streaming')
    })
    .sort((left, right) => latestMessageStamp(left[1]).localeCompare(latestMessageStamp(right[1])))
  if (evictable.length === 0) return messagesByThread

  const next = new Map(messagesByThread)
  for (const [threadId, messages] of evictable) {
    if (next.size <= MAX_CACHED_THREAD_MESSAGES && totalBytes <= MAX_CACHED_MESSAGE_BYTES) {
      break
    }
    next.delete(threadId)
    for (const message of messages) {
      totalBytes -= message.content.length
    }
  }
  return next
}

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
      const projectIds = new Set<string>([
        ...threads.map((thread) => thread.projectId),
        ...nextActiveThreadId.keys(),
      ])
      for (const projectId of projectIds) {
        const activeId = nextActiveThreadId.get(projectId)
        const projectThreads = threads.filter((thread) => thread.projectId === projectId)
        const preferredThread = choosePreferredThread(projectThreads)
        const activeThread = activeId ? nextThreads.get(activeId) : undefined
        if (
          !activeThread
          || (
            activeThread.status === 'disconnected'
            && preferredThread
            && preferredThread.id !== activeThread.id
            && preferredThread.status !== 'disconnected'
          )
        ) {
          nextActiveThreadId.set(projectId, preferredThread?.id ?? null)
        }
      }
      let messagesByThread = s.messagesByThread
      for (const thread of nextThreads.values()) {
        messagesByThread = reconcileThreadMessages(messagesByThread, thread.id, thread.status)
      }
      messagesByThread = new Map(messagesByThread)
      for (const threadId of messagesByThread.keys()) {
        if (!nextThreads.has(threadId)) {
          messagesByThread.delete(threadId)
        }
      }
      const sidebarItems = new Map(s.sidebarItems)
      for (const [projectId, items] of sidebarItems.entries()) {
        sidebarItems.set(
          projectId,
          items.filter((item) => {
            const thread = nextThreads.get(item.threadId)
            return thread?.projectId === projectId
          }),
        )
      }
      messagesByThread = pruneMessagesByThread(messagesByThread, nextActiveThreadId)
      return { threads: nextThreads, activeThreadId: nextActiveThreadId, messagesByThread, sidebarItems }
    }),

  hydrateApprovals: (approvals) => set({ approvals }),

  hydrateMessages: (threadId, messages) =>
    set((s) => {
      if (!s.threads.has(threadId)) return {}
      const messagesByThread = new Map(s.messagesByThread)
      messagesByThread.set(threadId, mergeThreadMessages(s.threads, messagesByThread.get(threadId) ?? [], messages))
      return { messagesByThread: pruneMessagesByThread(messagesByThread, s.activeThreadId) }
    }),

  hydrateSidebarItems: (projectId, items) =>
    set((s) => {
      const sidebarItems = new Map(s.sidebarItems)
      sidebarItems.set(
        projectId,
        items.filter((item) => s.threads.get(item.threadId)?.projectId === projectId),
      )
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
      const threads = new Map(s.threads)
      const thread = threads.get(threadId)
      if (!thread || thread.projectId !== projectId) {
        const currentId = activeThreadId.get(projectId)
        const currentThread = currentId ? threads.get(currentId) : undefined
        if (currentThread?.projectId === projectId) {
          return {}
        }
        const fallback = choosePreferredThread([...threads.values()].filter((candidate) => candidate.projectId === projectId))
        activeThreadId.set(projectId, fallback?.id ?? null)
        return { activeThreadId, messagesByThread: pruneMessagesByThread(s.messagesByThread, activeThreadId) }
      }
      activeThreadId.set(projectId, threadId)
      threads.set(threadId, { ...thread, unread: false })
      return { activeThreadId, threads, messagesByThread: pruneMessagesByThread(s.messagesByThread, activeThreadId) }
    }),

  updateThread: (threadId, patch) =>
    set((s) => {
      const threads = new Map(s.threads)
      const thread = threads.get(threadId)
      if (!thread) return s
      const nextThread = { ...thread, ...patch }
      threads.set(threadId, nextThread)
      const messagesByThread = pruneMessagesByThread(
        reconcileThreadMessages(s.messagesByThread, threadId, nextThread.status),
        s.activeThreadId,
      )
      return { threads, messagesByThread }
    }),

  upsertMessage: (message) =>
    set((s) => {
      const thread = s.threads.get(message.threadId)
      if (!thread || thread.projectId !== message.projectId) return {}
      const messagesByThread = new Map(s.messagesByThread)
      const current = messagesByThread.get(message.threadId) ?? []
      const next = mergeThreadMessages(s.threads, current, [message])
      messagesByThread.set(message.threadId, next)
      return { messagesByThread: pruneMessagesByThread(messagesByThread, s.activeThreadId) }
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
