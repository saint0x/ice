import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { MessageSquare, X, Send, Bot, User, Loader2, Sparkles } from 'lucide-react'
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
            <div className={styles.message}>
              <div className={styles.avatar}><User size={12} /></div>
              <div className={styles.messageContent}>
                <div className={styles.role}>You</div>
                <div className={styles.body}>
                  Can you implement the pane grid layout system? I need split views with drag handles.
                </div>
              </div>
            </div>
            <div className={styles.message}>
              <div className={`${styles.avatar} ${styles.assistantAvatar}`}><Bot size={12} /></div>
              <div className={styles.messageContent}>
                <div className={styles.role}>Codex</div>
                <div className={styles.body}>
                  I'll create a recursive split layout system. Each node is either a leaf pane or a split container with a drag handle.
                </div>
                <div className={styles.toolCall}>
                  <span className={styles.toolLabel}>Created</span>
                  <code>src/components/panes/PaneGrid.tsx</code>
                </div>
                <div className={styles.toolCall}>
                  <span className={styles.toolLabel}>Created</span>
                  <code>src/components/panes/Pane.tsx</code>
                </div>
              </div>
            </div>
            {activeThread.status === 'running' && (
              <div className={styles.thinking}>
                <Loader2 size={14} className={styles.spinner} />
                <span>Thinking...</span>
              </div>
            )}
          </div>
          <div className={styles.inputArea}>
            <input
              className={styles.input}
              placeholder="Ask Codex..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
            />
            <button className={styles.sendBtn} aria-label="Send">
              <Send size={13} />
            </button>
          </div>
        </>
      ) : (
        <div className={styles.threadList}>
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
          <div className={styles.inputArea}>
            <input
              className={styles.input}
              placeholder="Ask Codex..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
            />
            <button className={styles.sendBtn} aria-label="Send">
              <Send size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
})
