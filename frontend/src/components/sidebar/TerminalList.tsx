import { memo, useMemo } from 'react'
import { Terminal, Plus, X } from 'lucide-react'
import type { ProjectId } from '@/types'
import { createAndFocusTerminalSession } from '@/lib/terminalSessions'
import { closeTerminalSessionEverywhere } from '@/lib/workspaceTabs'
import { useNotificationsStore } from '@/stores/notifications'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'
import styles from './TerminalList.module.css'

export const TerminalList = memo(function TerminalList({ projectId }: { projectId: ProjectId }) {
  const allSessions = useTerminalStore((s) => s.sessions)
  const activeSessionId = useTerminalStore((s) => s.activeSessionId.get(projectId))
  const setActiveSession = useTerminalStore((s) => s.setActiveSession)
  const pushError = useNotificationsStore((s) => s.pushError)
  const setBottomDockOpen = useWorkspaceStore((s) => s.setBottomDockOpen)

  const sessions = useMemo(() => {
    const result = []
    for (const session of allSessions.values()) {
      if (session.projectId === projectId) result.push(session)
    }
    return result
  }, [allSessions, projectId])

  return (
    <div className={styles.list}>
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`${styles.row} ${session.id === activeSessionId ? styles.active : ''}`}
          onClick={() => {
            setActiveSession(projectId, session.id)
            setBottomDockOpen(true)
          }}
        >
          <Terminal size={12} />
          <span className={styles.title}>{session.title}</span>
          <button
            className={styles.closeBtn}
            onClick={(e) => {
              e.stopPropagation()
              void closeTerminalSessionEverywhere(session.id)
                .catch((error: unknown) => {
                  pushError('Terminal close failed', error, 'Failed to close terminal')
                })
            }}
            aria-label="Close terminal"
          >
            <X size={10} />
          </button>
        </div>
      ))}
      <button
        className={styles.addBtn}
        onClick={() => {
          void createAndFocusTerminalSession(projectId)
            .catch((error: unknown) => {
              pushError('Terminal create failed', error, 'Failed to create terminal')
            })
        }}
      >
        <Plus size={12} />
        <span>New Terminal</span>
      </button>
    </div>
  )
})
