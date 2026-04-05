import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Terminal, RotateCcw, PencilLine, Check, X, Clock3, FileTerminal, History, ShieldAlert, Copy, Eraser, Gauge, Layers3 } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTerminalStore } from '@/stores/terminal'
import { useProjectsStore } from '@/stores/projects'
import { TerminalSurface } from '@/components/surfaces/TerminalSurface'
import { terminalClose, terminalCreate, terminalDiagnosticsRead, terminalRename, terminalRespawn, terminalScrollbackClear, terminalScrollbackRead, toTerminalDiagnostics, toTerminalSession } from '@/lib/backend'
import styles from './BottomDock.module.css'

export const BottomDock = memo(function BottomDock() {
  const open = useWorkspaceStore((s) => s.bottomDockOpen)
  const height = useWorkspaceStore((s) => s.bottomDockHeight)
  const setOpen = useWorkspaceStore((s) => s.setBottomDockOpen)
  const setHeight = useWorkspaceStore((s) => s.setBottomDockHeight)
  const activeProjectId = useProjectsStore((s) => s.activeProjectId)
  const allSessions = useTerminalStore((s) => s.sessions)
  const allScrollback = useTerminalStore((s) => s.scrollback)
  const activeSessionId = useTerminalStore((s) => activeProjectId ? s.activeSessionId.get(activeProjectId) : null)
  const setActiveSession = useTerminalStore((s) => s.setActiveSession)
  const closeSession = useTerminalStore((s) => s.closeSession)
  const upsertSession = useTerminalStore((s) => s.upsertSession)
  const diagnostics = useTerminalStore((s) => s.diagnostics)
  const upsertDiagnostics = useTerminalStore((s) => s.upsertDiagnostics)
  const renameSession = useTerminalStore((s) => s.renameSession)
  const clearScrollback = useTerminalStore((s) => s.clearScrollback)
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const [isDiagnosticsLoading, setIsDiagnosticsLoading] = useState(false)
  const [isClearingHistory, setIsClearingHistory] = useState(false)

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
  const activeDiagnostics = activeSession ? diagnostics.get(activeSession.id) : undefined
  const activeScrollback = activeSession ? allScrollback.get(activeSession.id) ?? '' : ''
  const livePreview = useMemo(() => {
    const normalized = activeScrollback.replace(/\r/g, '').trim()
    if (!normalized) return activeDiagnostics?.recentLines.join('\n') ?? ''
    return normalized.split('\n').slice(-12).join('\n')
  }, [activeDiagnostics?.recentLines, activeScrollback])
  const liveLineCount = useMemo(() => {
    const normalized = activeScrollback.replace(/\r/g, '')
    return normalized ? normalized.split('\n').length : (activeDiagnostics?.scrollbackLineCount ?? 0)
  }, [activeDiagnostics?.scrollbackLineCount, activeScrollback])

  useEffect(() => {
    setRenameDraft(activeSession?.title ?? '')
    setIsRenaming(false)
  }, [activeSession?.id, activeSession?.title])

  useEffect(() => {
    if (!activeSession) {
      return
    }

    let disposed = false
    setIsDiagnosticsLoading(true)
    void terminalDiagnosticsRead(activeSession.id)
      .then((result) => {
        if (!disposed) {
          upsertDiagnostics(toTerminalDiagnostics(result))
          setIsDiagnosticsLoading(false)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSurfaceError(error instanceof Error ? error.message : 'Failed to load terminal diagnostics')
          setIsDiagnosticsLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [activeSession, upsertDiagnostics])

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

  const onClearHistory = async () => {
    if (!activeSession) return
    setIsClearingHistory(true)
    setSurfaceError(null)
    try {
      const updated = await terminalScrollbackClear(activeSession.id)
      upsertSession(toTerminalSession(updated))
      clearScrollback(activeSession.id)
      const diagnosticsRecord = await terminalDiagnosticsRead(activeSession.id)
      upsertDiagnostics(toTerminalDiagnostics(diagnosticsRecord))
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Failed to clear terminal history')
    } finally {
      setIsClearingHistory(false)
    }
  }

  const onCopyHistory = async () => {
    try {
      if (!activeSession) return
      const scrollback = await terminalScrollbackRead(activeSession.id)
      await navigator.clipboard.writeText(scrollback.content)
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Failed to copy terminal history')
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
              {activeDiagnostics ? (
                <div className={styles.diagnosticItem}>
                  <Layers3 size={12} />
                  <span>{liveLineCount} lines</span>
                </div>
              ) : null}
              {activeSession.startupCommand ? (
                <div className={styles.diagnosticItem}>
                  <Clock3 size={12} />
                  <span>{activeSession.startupCommand}</span>
                </div>
              ) : null}
              {activeDiagnostics?.envOverrides && Object.keys(activeDiagnostics.envOverrides).length > 0 ? (
                <div className={styles.diagnosticItem}>
                  <Gauge size={12} />
                  <span>{Object.keys(activeDiagnostics.envOverrides).length} env overrides</span>
                </div>
              ) : null}
              {activeSession.restoredFromPersistence ? (
                <div className={styles.diagnosticBadge}>
                  <ShieldAlert size={12} />
                  <span>Restored</span>
                </div>
              ) : null}
              {activeDiagnostics?.lastExitCode !== undefined ? (
                <div className={styles.diagnosticBadge}>
                  <Terminal size={12} />
                  <span>Exit {activeDiagnostics.lastExitCode}</span>
                </div>
              ) : null}
              {activeDiagnostics?.lastExitSignal ? (
                <div className={styles.diagnosticBadge}>
                  <Terminal size={12} />
                  <span>{activeDiagnostics.lastExitSignal}</span>
                </div>
              ) : null}
              {activeSession.lastExitReason ? (
                <div className={styles.diagnosticBadge}>
                  <Terminal size={12} />
                  <span>{activeSession.lastExitReason}</span>
                </div>
              ) : null}
              <button className={styles.diagnosticAction} onClick={() => void onCopyHistory()} disabled={!liveLineCount}>
                <Copy size={12} />
                <span>Copy</span>
              </button>
              <button className={styles.diagnosticAction} onClick={() => void onClearHistory()} disabled={isClearingHistory}>
                <Eraser size={12} />
                <span>{isClearingHistory ? 'Clearing…' : 'Clear'}</span>
              </button>
            </div>
            <div className={styles.historyPanel}>
              <div className={styles.historyHeader}>Recent scrollback</div>
              {isDiagnosticsLoading ? (
                <div className={styles.historyEmpty}>Loading terminal history...</div>
              ) : livePreview ? (
                <pre className={styles.historyPreview}>{livePreview}</pre>
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
