import { memo, useCallback, useMemo, useRef } from 'react'
import { ChevronDown, ChevronUp, Plus, Terminal } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTerminalStore } from '@/stores/terminal'
import { useProjectsStore } from '@/stores/projects'
import { TerminalSurface } from '@/components/surfaces/TerminalSurface'
import { terminalClose, terminalCreate, toTerminalSession } from '@/lib/backend'
import styles from './BottomDock.module.css'

export const BottomDock = memo(function BottomDock() {
  const open = useWorkspaceStore((s) => s.bottomDockOpen)
  const height = useWorkspaceStore((s) => s.bottomDockHeight)
  const setOpen = useWorkspaceStore((s) => s.setBottomDockOpen)
  const setHeight = useWorkspaceStore((s) => s.setBottomDockHeight)
  const activeProjectId = useProjectsStore((s) => s.activeProjectId)
  const allSessions = useTerminalStore((s) => s.sessions)
  const activeSessionId = useTerminalStore((s) => activeProjectId ? s.activeSessionId.get(activeProjectId) : null)
  const setActiveSession = useTerminalStore((s) => s.setActiveSession)
  const closeSession = useTerminalStore((s) => s.closeSession)
  const upsertSession = useTerminalStore((s) => s.upsertSession)
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null)

  const projectSessions = useMemo(() => {
    const result = []
    for (const session of allSessions.values()) {
      if (session.projectId === activeProjectId) result.push(session)
    }
    return result
  }, [allSessions, activeProjectId])

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      resizeRef.current = { startY: e.clientY, startH: height }
      const onMove = (e: MouseEvent) => {
        if (!resizeRef.current) return
        const delta = resizeRef.current.startY - e.clientY
        setHeight(resizeRef.current.startH + delta)
      }
      const onUp = () => {
        resizeRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [height, setHeight]
  )

  const activeSession = activeSessionId ? allSessions.get(activeSessionId) : null

  return (
    <div className={styles.dock} style={{ height: open ? height : 0 }}>
      <div className={styles.resizeHandle} onMouseDown={onResizeStart} />
      <div className={styles.header}>
        <div className={styles.tabs}>
          {projectSessions.map((session) => (
            <button
              key={session.id}
              className={`${styles.tab} ${session.id === activeSessionId ? styles.active : ''}`}
              onClick={() => activeProjectId && setActiveSession(activeProjectId, session.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  closeSession(session.id)
                  void terminalClose(session.id)
                }
              }}
            >
              <Terminal size={12} />
              <span className={styles.tabTitle}>{session.title}</span>
            </button>
          ))}
          <button
            className={styles.addBtn}
            onClick={() => {
              if (!activeProjectId) return
              void terminalCreate(activeProjectId).then((session) => {
                upsertSession(toTerminalSession(session))
                setActiveSession(activeProjectId, session.sessionId)
              })
            }}
            aria-label="New Terminal"
          >
            <Plus size={13} />
          </button>
        </div>
        <button className={styles.toggleBtn} onClick={() => setOpen(!open)} aria-label="Toggle dock">
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      <div className={styles.content}>
        {activeSession ? (
          <TerminalSurface key={activeSession.id} session={activeSession} />
        ) : (
          <div className={styles.empty}>
            <Terminal size={20} className={styles.emptyIcon} />
            <span>No terminal sessions</span>
          </div>
        )}
      </div>
    </div>
  )
})
