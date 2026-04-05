import { memo, useEffect, useMemo, useState } from 'react'
import {
  MessageSquare, Loader2, ArrowRight, Sparkles
} from 'lucide-react'
import type { CodexThread, Tab } from '@/types'
import { codexServerRequestDeny, codexServerRequestRespond, codexThreadCreate, codexThreadMessagesList, codexTurnStart, toCodexMessage } from '@/lib/backend'
import { useCodexStore } from '@/stores/codex'
import { CodexConversation } from '@/components/codex/CodexConversation'
import styles from './CodexSurface.module.css'

interface Props {
  tab: Tab
}

export const CodexSurface = memo(function CodexSurface({ tab }: Props) {
  const threadId = tab.meta?.threadId as string | undefined
  const thread = useCodexStore((s) => threadId ? s.threads.get(threadId) : undefined)
  const approvals = useCodexStore((s) => s.approvals.filter((approval) => approval.projectId === tab.projectId && (!threadId || approval.threadId === threadId)))
  const messages = useCodexStore((s) => threadId ? s.messagesByThread.get(threadId) ?? [] : [])
  const addThread = useCodexStore((s) => s.addThread)
  const setActiveThread = useCodexStore((s) => s.setActiveThread)
  const updateThread = useCodexStore((s) => s.updateThread)
  const hydrateMessages = useCodexStore((s) => s.hydrateMessages)
  const resolveApproval = useCodexStore((s) => s.resolveApproval)
  const clearUnread = useCodexStore((s) => s.clearUnread)
  const [input, setInput] = useState('')
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)

  useEffect(() => {
    if (!threadId) return
    clearUnread(threadId)
    let disposed = false
    setIsHistoryLoading(true)
    void codexThreadMessagesList(tab.projectId, threadId)
      .then((history) => {
        if (!disposed) {
          hydrateMessages(threadId, history.map(toCodexMessage))
          setIsHistoryLoading(false)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSurfaceError(error instanceof Error ? error.message : 'Failed to load thread history')
          setIsHistoryLoading(false)
        }
      })
    return () => {
      disposed = true
    }
  }, [clearUnread, hydrateMessages, tab.projectId, threadId])

  const statusLabel = useMemo(() => {
    if (!thread) return 'Ready'
    switch (thread.status) {
      case 'running':
        return 'Running'
      case 'waitingApproval':
      case 'waiting_approval':
        return 'Waiting Approval'
      case 'error':
        return 'Error'
      case 'disconnected':
        return 'Disconnected'
      default:
        return 'Idle'
    }
  }, [thread])

  const sendPrompt = async () => {
    const prompt = input.trim()
    if (!prompt) return
    setInput('')
    let targetThreadId = threadId
    if (!targetThreadId) {
      const created = await codexThreadCreate(tab.projectId, tab.title === 'New Thread' ? undefined : tab.title)
      const mapped: CodexThread = {
        id: created.threadId,
        projectId: created.projectId,
        title: created.title ?? 'New Thread',
        lastMessage: created.lastAssistantMessage ?? undefined,
        unread: false,
        status: created.status === 'waitingApproval' ? 'waitingApproval' : (created.status as 'idle' | 'running' | 'error' | 'disconnected'),
      }
      addThread(mapped)
      setActiveThread(tab.projectId, mapped.id)
      targetThreadId = created.threadId
    }
    if (targetThreadId) {
      updateThread(targetThreadId, { status: 'running', unread: false })
      await codexTurnStart(tab.projectId, targetThreadId, prompt)
    }
  }

  const handleApproval = async (approvalId: string, mode: 'approve' | 'deny') => {
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
      setSurfaceError(error instanceof Error ? error.message : 'Approval action failed')
    } finally {
      setApprovalBusyId(null)
    }
  }

  return (
    <div className={styles.surface}>
      <div className={styles.header}>
        <MessageSquare size={14} />
        <span className={styles.threadTitle}>{thread?.title ?? 'Codex Thread'}</span>
        <span className={styles.statusBadge}>
          {thread?.status === 'running' ? <Loader2 size={10} className={styles.spinner} /> : <Sparkles size={10} />}
          {statusLabel}
        </span>
      </div>

      <div className={styles.messages}>
        <div className={styles.metaCard}>
          <div className={styles.metaTitle}>Thread State</div>
          <div className={styles.metaBody}>
            {thread
              ? `Status: ${statusLabel}. ${thread.lastMessage ? 'Latest assistant output is shown below.' : 'No assistant output yet.'}`
              : 'No thread is attached to this tab yet. Sending a prompt will create one through the backend.'}
          </div>
        </div>
        {isHistoryLoading ? (
          <div className={styles.loadingState}>
            <Loader2 size={16} className={styles.spinner} />
            <span>Loading thread history...</span>
          </div>
        ) : null}
        <CodexConversation
          approvals={approvals}
          approvalBusyId={approvalBusyId}
          fallbackMessage={thread ? 'Thread is ready. Send the next prompt to Codex.' : 'Start a new Codex thread by sending a prompt.'}
          messages={messages}
          onApproval={handleApproval}
          surfaceError={surfaceError}
          threadStatus={thread?.status}
        />
      </div>

      <div className={styles.inputArea}>
        <div className={styles.inputWrapper}>
          <input
            className={styles.input}
            placeholder="Send a message..."
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
  )
})
