import { memo, useState } from 'react'
import {
  MessageSquare, Loader2, Bot, FileCode, TerminalSquare, ArrowRight
} from 'lucide-react'
import type { Tab } from '@/types'
import { useCodexStore } from '@/stores/codex'
import styles from './CodexSurface.module.css'

interface Props {
  tab: Tab
}

export const CodexSurface = memo(function CodexSurface({ tab }: Props) {
  const threadId = tab.meta?.threadId as string | undefined
  const thread = useCodexStore((s) => threadId ? s.threads.get(threadId) : undefined)
  const [input, setInput] = useState('')

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
        {/* User — right */}
        <div className={styles.userRow}>
          <div className={styles.userBubble}>
            Can you implement the pane grid layout system? I need split views with drag handles that feel native.
          </div>
        </div>

        {/* Agent — left */}
        <div className={styles.agentRow}>
          <div className={styles.agentAvatar}>
            <Bot size={14} />
          </div>
          <div className={styles.agentContent}>
            <div className={styles.agentBubble}>
              I'll create a recursive split layout system with smooth drag resizing. The implementation will use a tree structure where each node is either a leaf pane or a split container.
            </div>
            <div className={styles.artifacts}>
              <div className={styles.artifact}>
                <FileCode size={12} />
                <span>PaneGrid.tsx</span>
                <span className={styles.artifactAction}>Created</span>
              </div>
              <div className={styles.artifact}>
                <FileCode size={12} />
                <span>Pane.tsx</span>
                <span className={styles.artifactAction}>Created</span>
              </div>
            </div>
          </div>
        </div>

        {/* User */}
        <div className={styles.userRow}>
          <div className={styles.userBubble}>
            Now add resize handles and keyboard shortcuts.
          </div>
        </div>

        {/* Agent */}
        <div className={styles.agentRow}>
          <div className={styles.agentAvatar}>
            <Bot size={14} />
          </div>
          <div className={styles.agentContent}>
            <div className={styles.agentBubble}>
              Done. <code>Cmd+\</code> splits horizontally, <code>Cmd+Shift+\</code> splits vertically. Drag handles respond to mouse events with <code>4px</code> hit targets.
            </div>
            <div className={styles.artifacts}>
              <div className={styles.artifact}>
                <TerminalSquare size={12} />
                <span>useKeyboardShortcuts.ts</span>
                <span className={styles.artifactAction}>Modified</span>
              </div>
            </div>
          </div>
        </div>

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
                setInput('')
              }
            }}
          />
          <button
            className={`${styles.sendBtn} ${input.trim() ? styles.sendBtnReady : ''}`}
            aria-label="Send"
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
})
