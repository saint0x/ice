import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Terminal, RotateCcw, PencilLine, Check, X, Clock3, FileTerminal, History, ShieldAlert } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTerminalStore } from '@/stores/terminal'
import { useProjectsStore } from '@/stores/projects'
import { TerminalSurface } from '@/components/surfaces/TerminalSurface'
import { terminalClose, terminalCreate, terminalRename, terminalRespawn, terminalScrollbackRead, toTerminalSession } from '@/lib/backend'
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
  const renameSession = useTerminalStore((s) => s.renameSession)
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const [scrollbackPreview, setScrollbackPreview] = useState<string>('')
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)

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

  useEffect(() => {
    setRenameDraft(activeSession?.title ?? '')
    setIsRenaming(false)
  }, [activeSession?.id, activeSession?.title])

  useEffect(() => {
    if (!activeSession) {
      setScrollbackPreview('')
      return
    }

    let disposed = false
    setIsPreviewLoading(true)
    void terminalScrollbackRead(activeSession.id)
      .then((result) => {
        if (!disposed) {
          const trimmed = result.content.trim()
          const preview = trimmed
            ? trimmed.split('\n').slice(-6).join('\n')
            : ''
          setScrollbackPreview(preview)
          setIsPreviewLoading(false)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setScrollbackPreview('')
          setSurfaceError(error instanceof Error ? error.message : 'Failed to load terminal history preview')
          setIsPreviewLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [activeSession])

  const onRenameCommit = async () => {
    if (!activeSession || !renameDraft.trim()) {
      setIsRenaming(false)
      setRenameDraft(activeSession?.title ?? '')
      return
    }
    setSurfaceError(null)
    try {
      const updated = await terminalRename(activeSession.id, renameDraft.trim())
      const mapped = toTerminalSession(updated)
      upsertSession(mapped)
      renameSession(mapped.id, mapped.title)
      setIsRenaming(false)
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Failed to rename terminal')
    }
  }

  const onRespawn = async () => {
    if (!activeSession) return
    setIsRestarting(true)
    setSurfaceError(null)
    try {
      const updated = await terminalRespawn(activeSession.id)
      upsertSession(toTerminalSession(updated))
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Failed to restart terminal')
    } finally {
      setIsRestarting(false)
    }
  }

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
        {activeSession && (
          <div className={styles.sessionMeta}>
            {isRenaming ? (
              <div className={styles.renameBox}>
                <input
                  className={styles.renameInput}
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void onRenameCommit()
                    }
                    if (event.key === 'Escape') {
                      setIsRenaming(false)
                      setRenameDraft(activeSession.title)
                    }
                  }}
                />
                <button className={styles.metaBtn} onClick={() => void onRenameCommit()} aria-label="Save terminal name">
                  <Check size={12} />
                </button>
                <button
                  className={styles.metaBtn}
                  onClick={() => {
                    setIsRenaming(false)
                    setRenameDraft(activeSession.title)
                  }}
                  aria-label="Cancel terminal rename"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <>
                <span className={styles.sessionPath}>{activeSession.cwd}</span>
                <span className={styles.sessionShell}>{activeSession.shellPath ?? activeSession.shell ?? 'shell'}</span>
                <button className={styles.metaBtn} onClick={() => setIsRenaming(true)} aria-label="Rename terminal">
                  <PencilLine size={12} />
                </button>
                {!activeSession.isRunning && (
                  <button className={styles.metaBtn} onClick={() => void onRespawn()} disabled={isRestarting} aria-label="Respawn terminal">
                    <RotateCcw size={12} className={isRestarting ? styles.spin : undefined} />
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <button className={styles.toggleBtn} onClick={() => setOpen(!open)} aria-label="Toggle dock">
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      <div className={styles.content}>
        {surfaceError && <div className={styles.errorBanner}>{surfaceError}</div>}
        {activeSession ? (
          <>
            <div className={styles.diagnosticsStrip}>
              <div className={styles.diagnosticItem}>
                <FileTerminal size={12} />
                <span>{activeSession.cwd}</span>
              </div>
              <div className={styles.diagnosticItem}>
                <History size={12} />
                <span>{formatBytes(activeSession.scrollbackBytes ?? 0)} scrollback</span>
              </div>
              {activeSession.startupCommand ? (
                <div className={styles.diagnosticItem}>
                  <Clock3 size={12} />
                  <span>{activeSession.startupCommand}</span>
                </div>
              ) : null}
              {activeSession.restoredFromPersistence ? (
                <div className={styles.diagnosticBadge}>
                  <ShieldAlert size={12} />
                  <span>Restored</span>
                </div>
              ) : null}
              {activeSession.lastExitReason ? (
                <div className={styles.diagnosticBadge}>
                  <Terminal size={12} />
                  <span>{activeSession.lastExitReason}</span>
                </div>
              ) : null}
            </div>
            <div className={styles.historyPanel}>
              <div className={styles.historyHeader}>Recent scrollback</div>
              {isPreviewLoading ? (
                <div className={styles.historyEmpty}>Loading terminal history...</div>
              ) : scrollbackPreview ? (
                <pre className={styles.historyPreview}>{scrollbackPreview}</pre>
              ) : (
                <div className={styles.historyEmpty}>No persisted scrollback yet.</div>
              )}
            </div>
            <TerminalSurface key={activeSession.id} session={activeSession} />
          </>
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

function formatBytes(value: number) {
  if (value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
