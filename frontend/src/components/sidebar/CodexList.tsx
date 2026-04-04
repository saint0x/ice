import { memo, useMemo } from 'react'
import { MessageSquare, Circle, Loader2 } from 'lucide-react'
import type { ProjectId } from '@/types'
import { useCodexStore } from '@/stores/codex'
import { useWorkspaceStore } from '@/stores/workspace'
import styles from './CodexList.module.css'

export const CodexList = memo(function CodexList({ projectId }: { projectId: ProjectId }) {
  const allThreads = useCodexStore((s) => s.threads)
  const activeThreadId = useCodexStore((s) => s.activeThreadId.get(projectId))
  const setActiveThread = useCodexStore((s) => s.setActiveThread)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)

  const threads = useMemo(() => {
    const result = []
    for (const thread of allThreads.values()) {
      if (thread.projectId === projectId) result.push(thread)
    }
    return result
  }, [allThreads, projectId])

  return (
    <div className={styles.list}>
      {threads.map((thread) => (
        <div
          key={thread.id}
          className={`${styles.row} ${thread.id === activeThreadId ? styles.active : ''}`}
          onClick={() => {
            setActiveThread(projectId, thread.id)
            openTab(activePaneId, 'codex', thread.title, projectId, { threadId: thread.id })
          }}
        >
          <MessageSquare size={12} />
          <span className={styles.title}>{thread.title}</span>
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
