import { memo } from 'react'
import { MessageSquare, Loader2, Send, Bot, User } from 'lucide-react'
import type { Tab } from '@/types'
import { useCodexStore } from '@/stores/codex'
import styles from './CodexSurface.module.css'

interface Props {
  tab: Tab
}

export const CodexSurface = memo(function CodexSurface({ tab }: Props) {
  const threadId = tab.meta?.threadId as string | undefined
  const thread = useCodexStore((s) => threadId ? s.threads.get(threadId) : undefined)

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
        <div className={styles.message}>
          <div className={styles.messageHeader}>
            <User size={12} />
            <span className={styles.role}>You</span>
          </div>
          <div className={styles.messageBody}>
            Can you implement the pane grid layout system? I need split views with drag handles that feel native.
          </div>
        </div>
        <div className={`${styles.message} ${styles.assistant}`}>
          <div className={styles.messageHeader}>
            <Bot size={12} />
            <span className={styles.role}>Codex</span>
          </div>
          <div className={styles.messageBody}>
            I'll create a recursive split layout system with smooth drag resizing. The implementation will use a tree structure where each node is either a leaf pane or a split container.
          </div>
          <div className={styles.toolEvent}>
            <span className={styles.toolLabel}>Created file</span>
            <code className={styles.toolValue}>src/components/panes/PaneGrid.tsx</code>
          </div>
          <div className={styles.toolEvent}>
            <span className={styles.toolLabel}>Created file</span>
            <code className={styles.toolValue}>src/components/panes/Pane.tsx</code>
          </div>
        </div>
      </div>
      <div className={styles.inputArea}>
        <input
          className={styles.input}
          placeholder="Send a message..."
          spellCheck={false}
        />
        <button className={styles.sendBtn} aria-label="Send">
          <Send size={13} />
        </button>
      </div>
    </div>
  )
})
