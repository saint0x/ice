import { memo } from 'react'
import { MessageSquare, Circle, Loader2 } from 'lucide-react'
import type { ProjectId } from '@/types'
import { useCodexStore } from '@/stores/codex'
import { useWorkspaceStore } from '@/stores/workspace'
import styles from './CodexList.module.css'

export const CodexList = memo(function CodexList({ projectId }: { projectId: ProjectId }) {
  const threads = useCodexStore((s) => s.sidebarItems.get(projectId) ?? [])
  const activeThreadId = useCodexStore((s) => s.activeThreadId.get(projectId))
  const setActiveThread = useCodexStore((s) => s.setActiveThread)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)

  return (
    <div className={styles.list}>
      {threads.map((thread) => (
        <div
          key={thread.threadId}
          className={`${styles.row} ${thread.threadId === activeThreadId ? styles.active : ''}`}
          onClick={() => {
            setActiveThread(projectId, thread.threadId)
            openTab(activePaneId, 'codex', thread.title, projectId, { threadId: thread.threadId })
          }}
        >
          <MessageSquare size={12} />
          <div className={styles.copy}>
            <span className={styles.title}>{thread.title}</span>
            {thread.lastAssistantMessage ? (
              <span className={styles.preview}>{thread.lastAssistantMessage}</span>
            ) : null}
          </div>
          {thread.status === 'running' && <Loader2 size={10} className={styles.spinner} />}
          {thread.unread && <Circle size={6} className={styles.unread} />}
        </div>
      ))}
      {threads.length === 0 && (
        <div className={styles.empty}>No threads</div>
      )}
    </div>
  )
})
