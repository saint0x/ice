import { memo, useState } from 'react'
import {
  MessageSquare, Loader2, Bot, ShieldAlert, ArrowRight
} from 'lucide-react'
import type { Tab } from '@/types'
import { codexThreadCreate, codexTurnStart } from '@/lib/backend'
import { useCodexStore } from '@/stores/codex'
import styles from './CodexSurface.module.css'

interface Props {
  tab: Tab
}

export const CodexSurface = memo(function CodexSurface({ tab }: Props) {
  const threadId = tab.meta?.threadId as string | undefined
  const thread = useCodexStore((s) => threadId ? s.threads.get(threadId) : undefined)
  const approvals = useCodexStore((s) => s.approvals.filter((approval) => approval.projectId === tab.projectId && (!threadId || approval.threadId === threadId)))
  const addThread = useCodexStore((s) => s.addThread)
  const [input, setInput] = useState('')

  const sendPrompt = async () => {
    const prompt = input.trim()
    if (!prompt) return
    setInput('')
    let targetThreadId = threadId
    if (!targetThreadId) {
      const created = await codexThreadCreate(tab.projectId, tab.title === 'New Thread' ? undefined : tab.title)
      addThread({
        id: created.threadId,
        projectId: created.projectId,
        title: created.title ?? 'New Thread',
        lastMessage: created.lastAssistantMessage ?? undefined,
        unread: created.unread,
        status: created.status === 'waitingApproval' ? 'waitingApproval' : (created.status as 'idle' | 'running' | 'error' | 'disconnected'),
      })
      targetThreadId = created.threadId
    }
    if (targetThreadId) {
      await codexTurnStart(tab.projectId, targetThreadId, prompt)
    }
  }

  return (
    <div className={styles.surface}>
      <div className={styles.header}>
        <MessageSquare size={14} />
        <span className={styles.threadTitle}>{thread?.title ?? 'Codex Thread'}</span>
        {thread?.status === 'running' && (
          <span className={styles.statusBadge}>
            <Loader2 size={10} className={styles.spinner} /> Running
          </span>
        )}
      </div>

      <div className={styles.messages}>
        {thread?.lastMessage ? (
          <div className={styles.agentRow}>
            <div className={styles.agentAvatar}>
              <Bot size={14} />
            </div>
            <div className={styles.agentContent}>
              <div className={styles.agentBubble}>{thread.lastMessage}</div>
            </div>
          </div>
        ) : (
          <div className={styles.agentRow}>
            <div className={styles.agentAvatar}>
              <Bot size={14} />
            </div>
            <div className={styles.agentContent}>
              <div className={styles.agentBubble}>
                {thread ? 'Thread is ready. Send the next prompt to Codex.' : 'Start a new Codex thread by sending a prompt.'}
              </div>
            </div>
          </div>
        )}

        {approvals.map((approval) => (
          <div key={approval.id} className={styles.agentRow}>
            <div className={styles.agentAvatar}>
              <ShieldAlert size={14} />
            </div>
            <div className={styles.agentContent}>
              <div className={styles.agentBubble}>
                Approval required: {approval.description}
              </div>
            </div>
          </div>
        ))}

        {thread?.status === 'running' && (
          <div className={styles.agentRow}>
            <div className={styles.agentAvatar}>
              <Loader2 size={14} className={styles.spinner} />
            </div>
            <div className={styles.thinkingLabel}>Thinking...</div>
          </div>
        )}
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
