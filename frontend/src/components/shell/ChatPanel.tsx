import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MessageSquare, X, Loader2, Sparkles, ArrowRight
} from 'lucide-react'
import type { CodexApproval, CodexMessage, CodexThread, PaneLayout, ProjectId, Tab, ThreadId } from '@/types'
import { codexServerRequestDeny, codexServerRequestRespond, codexThreadCreate, codexThreadMessagesList, codexTurnStart, toCodexMessage, toCodexThread } from '@/lib/backend'
import { CodexConversation } from '@/components/codex/CodexConversation'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectsStore } from '@/stores/projects'
import { useCodexStore } from '@/stores/codex'
import { useNotificationsStore } from '@/stores/notifications'
import { describeCodexError } from '@/lib/errors'
import styles from './ChatPanel.module.css'

const EMPTY_APPROVALS: CodexApproval[] = []
const EMPTY_MESSAGES: CodexMessage[] = []

export const ChatPanel = memo(function ChatPanel() {
  const chatOpen = useWorkspaceStore((s) => s.chatPanelOpen)
  const chatWidth = useWorkspaceStore((s) => s.chatPanelWidth)
  const setChatOpen = useWorkspaceStore((s) => s.setChatPanelOpen)
  const setChatWidth = useWorkspaceStore((s) => s.setChatPanelWidth)
  const layout = useWorkspaceStore((s) => s.layout)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const workspaceTabs = useWorkspaceStore((s) => s.tabs)
  const activeProjectId = useProjectsStore((s) => s.activeProjectId)
  const projectOrder = useProjectsStore((s) => s.projectOrder)
  const fallbackProjectId = useMemo(
    () => resolveProjectIdFromWorkspace(layout, activePaneId, workspaceTabs),
    [activePaneId, layout, workspaceTabs],
  )
  const codexActiveThreads = useCodexStore((s) => s.activeThreadId)
  const inferredChatProjectId = useMemo(
    () => inferChatProjectId(activeProjectId, fallbackProjectId, codexActiveThreads, projectOrder),
    [activeProjectId, fallbackProjectId, codexActiveThreads, projectOrder],
  )
  const resolvedProjectId = inferredChatProjectId
  const project = useProjectsStore((s) => resolvedProjectId ? s.projects.get(resolvedProjectId) : undefined)
  const allThreads = useCodexStore((s) => s.threads)
  const sidebarItems = useCodexStore((s) => resolvedProjectId ? s.sidebarItems.get(resolvedProjectId) : undefined)
  const activeThreadId = useCodexStore((s) => resolvedProjectId ? s.activeThreadId.get(resolvedProjectId) : undefined)
  const setActiveThread = useCodexStore((s) => s.setActiveThread)
  const addThread = useCodexStore((s) => s.addThread)
  const allApprovals = useCodexStore((s) => s.approvals)
  const threadMessages = useCodexStore((s) => activeThreadId ? s.messagesByThread.get(activeThreadId) : undefined)
  const resolveApproval = useCodexStore((s) => s.resolveApproval)
  const updateThread = useCodexStore((s) => s.updateThread)
  const hydrateMessages = useCodexStore((s) => s.hydrateMessages)
  const clearUnread = useCodexStore((s) => s.clearUnread)
  const pushError = useNotificationsStore((s) => s.pushError)

  const [input, setInput] = useState('')
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)
  const activeThread = activeThreadId ? allThreads.get(activeThreadId) : undefined

  useEffect(() => {
    if (!resolvedProjectId || !activeThreadId || threadMessages !== undefined) return
    clearUnread(activeThreadId)
    let disposed = false
    setIsHistoryLoading(true)
    void codexThreadMessagesList(resolvedProjectId, activeThreadId)
      .then((history) => {
        if (!disposed) {
          hydrateMessages(activeThreadId, history.map(toCodexMessage))
          setIsHistoryLoading(false)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSurfaceError(
            describeCodexError('Failed to load Codex conversation history', error, {
              projectName: project?.name,
              threadTitle: activeThread?.title,
            }),
          )
          setIsHistoryLoading(false)
        }
      })
    return () => {
      disposed = true
    }
  }, [activeThread?.title, activeThreadId, clearUnread, hydrateMessages, project?.name, resolvedProjectId, threadMessages])

  const threads = useMemo(() => {
    const result = []
    if (sidebarItems?.length) {
      for (const item of sidebarItems) {
        const thread = allThreads.get(item.threadId)
        if (thread && thread.projectId === resolvedProjectId) {
          result.push(thread)
        }
      }
    }
    if (result.length === 0) {
      for (const thread of allThreads.values()) {
        if (thread.projectId === resolvedProjectId) result.push(thread)
      }
      result.sort((left, right) => (
        Number(right.unread) - Number(left.unread)
        || right.id.localeCompare(left.id)
      ))
    }
    return result
  }, [allThreads, resolvedProjectId, sidebarItems])
  const approvals = useMemo(
    () => (
      resolvedProjectId && activeThreadId
        ? allApprovals.filter((approval) => approval.projectId === resolvedProjectId && approval.threadId === activeThreadId)
        : EMPTY_APPROVALS
    ),
    [resolvedProjectId, activeThreadId, allApprovals],
  )
  const messages = useMemo(
    () => threadMessages ?? EMPTY_MESSAGES,
    [threadMessages],
  )

  const createThread = useCallback(async () => {
    if (!resolvedProjectId) return null
    const created = await codexThreadCreate(resolvedProjectId)
    const mapped = toCodexThread(created)
    addThread(mapped)
    setActiveThread(resolvedProjectId, mapped.id)
    return mapped
  }, [resolvedProjectId, addThread, setActiveThread])

  const sendPrompt = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt) return
    if (!resolvedProjectId) {
      const message = 'Unable to determine which project this chat should use.'
      setSurfaceError(message)
      return
    }
    setInput('')
    setSurfaceError(null)
    let threadId: string | undefined
    try {
      threadId = (
        activeThreadId
        && isReusableCodexThread(allThreads.get(activeThreadId))
      ) ? activeThreadId : undefined
      if (!threadId) {
        const mapped = await createThread()
        threadId = mapped?.id
      }
      if (threadId) {
        updateThread(threadId, { status: 'running', unread: false })
        try {
          await codexTurnStart(resolvedProjectId, threadId, prompt)
        } catch (error) {
          if (!shouldReplaceCodexThread(error) || !threadId) {
            throw error
          }
          const replacement = await createThread()
          if (!replacement) {
            throw error
          }
          threadId = replacement.id
          updateThread(threadId, { status: 'running', unread: false })
          await codexTurnStart(resolvedProjectId, threadId, prompt)
        }
      }
    } catch (error) {
      if (threadId) {
        updateThread(threadId, { status: 'error', unread: false })
      }
      const message = describeCodexError('Failed to send Codex prompt', error, {
        projectName: project?.name,
        threadTitle: activeThread?.title,
      })
      setSurfaceError(message)
      pushError('Codex request failed', error, message)
    }
}, [resolvedProjectId, activeThread?.title, activeThreadId, allThreads, createThread, input, project?.name, pushError, updateThread])

  const handleApproval = useCallback(async (approvalId: string, mode: 'approve' | 'deny') => {
    setApprovalBusyId(approvalId)
    setSurfaceError(null)
    try {
      if (mode === 'approve') {
        await codexServerRequestRespond(Number(approvalId))
      } else {
        await codexServerRequestDeny(Number(approvalId))
      }
      resolveApproval(approvalId)
    } catch (error) {
      setSurfaceError(
        describeCodexError('Failed to respond to Codex approval request', error, {
          projectName: project?.name,
          threadTitle: activeThread?.title,
        }),
      )
    } finally {
      setApprovalBusyId(null)
    }
  }, [activeThread?.title, project?.name, resolveApproval])

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      resizeRef.current = { startX: e.clientX, startW: chatWidth }
      const onMove = (e: MouseEvent) => {
        if (!resizeRef.current) return
        const delta = resizeRef.current.startX - e.clientX
        setChatWidth(resizeRef.current.startW + delta)
      }
      const onUp = () => {
        resizeRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [chatWidth, setChatWidth]
  )

  if (!chatOpen) return null

  return (
    <div className={styles.panel} style={{ width: chatWidth }}>
      <div className={styles.resizeHandle} onMouseDown={onResizeStart} />
      <div className={styles.header}>
        <Sparkles size={14} className={styles.headerIcon} />
        <span className={styles.headerTitle}>
          {activeThread ? activeThread.title : 'Codex'}
        </span>
        {project && <span className={styles.headerProject}>{project.name}</span>}
        <button className={styles.closeBtn} onClick={() => setChatOpen(false)} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      {activeThread ? (
        <>
          <div className={styles.threadList}>
            {isHistoryLoading ? (
              <div className={styles.loadingState}>
                <Loader2 size={14} className={styles.spinner} />
                <span>Loading conversation history...</span>
              </div>
            ) : null}
            <CodexConversation
              approvals={approvals}
              approvalBusyId={approvalBusyId}
              fallbackMessage={activeThread.lastMessage ?? 'Thread is ready. Send the next prompt to Codex.'}
              messages={messages}
              onApproval={handleApproval}
              projectId={resolvedProjectId ?? undefined}
              projectPath={project?.path}
              surfaceError={surfaceError}
              threadStatus={activeThread.status}
            />
          </div>

          <div className={styles.inputArea}>
            <div className={styles.inputWrapper}>
              <input
                className={styles.input}
                placeholder="Ask Codex..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && input.trim()) {
                    e.preventDefault()
                    void sendPrompt()
                  }
                }}
              />
              <button
                className={`${styles.sendBtn} ${input.trim() ? styles.sendBtnReady : ''}`}
                aria-label="Send"
                onClick={() => void sendPrompt()}
              >
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className={styles.threadList}>
          <div className={styles.threadListInner}>
            {threads.length > 0 ? (
              threads.map((t) => (
                <button
                  key={t.id}
                  className={`${styles.threadRow} ${t.id === activeThreadId ? styles.threadRowActive : ''}`}
                  onClick={() => resolvedProjectId && setActiveThread(resolvedProjectId, t.id)}
                >
                  <MessageSquare size={12} />
                  <span className={styles.threadTitle}>{t.title}</span>
                  {t.status === 'running' && <Loader2 size={10} className={styles.spinner} />}
                  {t.unread && <span className={styles.threadUnread} />}
                </button>
              ))
            ) : (
              <div className={styles.emptyState}>
                <Sparkles size={24} className={styles.emptyIcon} />
                <span className={styles.emptyTitle}>No conversations yet</span>
                <span className={styles.emptyHint}>Start a conversation with Codex</span>
              </div>
            )}
          </div>
          <div className={styles.inputArea}>
            <div className={styles.inputWrapper}>
              <input
                className={styles.input}
                placeholder="Ask Codex..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && input.trim()) {
                    e.preventDefault()
                    void sendPrompt()
                  }
                }}
              />
              <button
                className={`${styles.sendBtn} ${input.trim() ? styles.sendBtnReady : ''}`}
                aria-label="Send"
                onClick={() => void sendPrompt()}
              >
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

function resolveProjectIdFromWorkspace(
  layout: PaneLayout,
  activePaneId: string,
  tabs: Map<string, Tab>,
): ProjectId | null {
  const activeTabId = findActiveTabId(layout, activePaneId)
  if (!activeTabId) return null
  return tabs.get(activeTabId)?.projectId ?? null
}

function findActiveTabId(layout: PaneLayout, activePaneId: string): string | null {
  if (layout.type === 'leaf') {
    return layout.id === activePaneId ? layout.activeTabId : null
  }
  for (const child of layout.children) {
    const tabId = findActiveTabId(child, activePaneId)
    if (tabId) return tabId
  }
  return null
}

function inferChatProjectId(
  activeProjectId: ProjectId | null,
  workspaceProjectId: ProjectId | null,
  activeThreadsByProject: Map<ProjectId, ThreadId | null>,
  projectOrder: ProjectId[],
): ProjectId | null {
  if (activeProjectId) return activeProjectId
  if (workspaceProjectId) return workspaceProjectId
  const projectsWithActiveThreads = Array.from(activeThreadsByProject.entries())
    .filter(([, threadId]) => Boolean(threadId))
    .map(([projectId]) => projectId)
  if (projectsWithActiveThreads.length === 1) {
    return projectsWithActiveThreads[0] ?? null
  }
  if (projectOrder.length === 1) {
    return projectOrder[0] ?? null
  }
  return null
}

function shouldReplaceCodexThread(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /thread not found|unable to resume codex thread/i.test(error.message)
}

function isReusableCodexThread(thread: CodexThread | undefined) {
  return Boolean(thread && thread.status !== 'disconnected')
}
