import { memo, useCallback, useMemo, useRef, useState } from 'react'
import {
  MessageSquare, X, Bot, Loader2, Sparkles,
  ShieldAlert, ArrowRight, Check, Ban
} from 'lucide-react'
import { codexServerRequestDeny, codexServerRequestRespond, codexThreadCreate, codexTurnStart, toCodexThread } from '@/lib/backend'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectsStore } from '@/stores/projects'
import { useCodexStore } from '@/stores/codex'
import styles from './ChatPanel.module.css'

export const ChatPanel = memo(function ChatPanel() {
  const chatOpen = useWorkspaceStore((s) => s.chatPanelOpen)
  const chatWidth = useWorkspaceStore((s) => s.chatPanelWidth)
  const setChatOpen = useWorkspaceStore((s) => s.setChatPanelOpen)
  const setChatWidth = useWorkspaceStore((s) => s.setChatPanelWidth)
  const activeProjectId = useProjectsStore((s) => s.activeProjectId)
  const project = useProjectsStore((s) => activeProjectId ? s.projects.get(activeProjectId) : undefined)
  const allThreads = useCodexStore((s) => s.threads)
  const activeThreadId = useCodexStore((s) => activeProjectId ? s.activeThreadId.get(activeProjectId) : undefined)
  const setActiveThread = useCodexStore((s) => s.setActiveThread)
  const addThread = useCodexStore((s) => s.addThread)
  const approvals = useCodexStore((s) => s.approvals.filter((approval) => approval.projectId === activeProjectId))

  const [input, setInput] = useState('')
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)

  const threads = useMemo(() => {
    const result = []
    for (const thread of allThreads.values()) {
      if (thread.projectId === activeProjectId) result.push(thread)
    }
    return result
  }, [allThreads, activeProjectId])

  const activeThread = activeThreadId ? allThreads.get(activeThreadId) : undefined

  const sendPrompt = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || !activeProjectId) return
    setInput('')
    let threadId = activeThreadId
    if (!threadId) {
      const created = await codexThreadCreate(activeProjectId)
      const mapped = toCodexThread(created)
      addThread(mapped)
      setActiveThread(activeProjectId, mapped.id)
      threadId = mapped.id
    }
    if (threadId) {
      await codexTurnStart(activeProjectId, threadId, prompt)
    }
  }, [activeProjectId, activeThreadId, addThread, input, setActiveThread])

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
          <div className={styles.messages}>
            <div className={styles.agentRow}>
              <div className={styles.agentAvatar}>
                <Bot size={14} />
              </div>
              <div className={styles.agentContent}>
                <div className={styles.agentBubble}>
                  {activeThread.lastMessage ?? 'Thread is ready. Send the next prompt to Codex.'}
                </div>
              </div>
            </div>

            {approvals.map((approval) => (
              <div key={approval.id} className={styles.agentRow}>
                <div className={styles.agentAvatar}>
                  <ShieldAlert size={14} />
                </div>
                <div className={styles.agentContent}>
                  <div className={styles.agentBubble}>
                    {approval.description}
                  </div>
                  <div className={styles.artifacts}>
                    <button className={styles.artifact} onClick={() => void codexServerRequestRespond(Number(approval.id))}>
                      <Check size={12} />
                      <span>Approve</span>
                    </button>
                    <button className={styles.artifact} onClick={() => void codexServerRequestDeny(Number(approval.id))}>
                      <Ban size={12} />
                      <span>Deny</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {activeThread.status === 'running' && (
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
                <button key={t.id} className={styles.threadRow}>
                  <MessageSquare size={12} />
                  <span className={styles.threadTitle}>{t.title}</span>
                  {t.status === 'running' && <Loader2 size={10} className={styles.spinner} />}
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
