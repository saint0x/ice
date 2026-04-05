import { memo, useRef, useEffect, useState } from 'react'
import { Loader2, RotateCcw, TerminalSquare, Hand, CornerDownLeft, History, Gauge, ShieldAlert } from 'lucide-react'
import type { TerminalSession } from '@/types'
import { terminalDiagnosticsRead, terminalInterrupt, terminalResize, terminalRespawn, terminalSendEof, terminalWrite, toTerminalDiagnostics, toTerminalSession } from '@/lib/backend'
import { useThemeStore } from '@/stores/theme'
import { useTerminalStore } from '@/stores/terminal'
import styles from './TerminalSurface.module.css'

interface Props {
  session: TerminalSession
}

function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function buildTerminalTheme() {
  return {
    background: getCssVar('--bg-editor') || getCssVar('--bg-surface'),
    foreground: getCssVar('--text-primary'),
    cursor: getCssVar('--text-primary'),
    selectionBackground: getCssVar('--bg-element-selected'),
    black: getCssVar('--bg-window'),
    red: getCssVar('--color-error'),
    green: getCssVar('--color-success'),
    yellow: getCssVar('--color-warning'),
    blue: getCssVar('--syn-function'),
    magenta: getCssVar('--syn-keyword'),
    cyan: getCssVar('--color-info'),
    white: getCssVar('--text-primary'),
    brightBlack: getCssVar('--text-disabled'),
    brightRed: getCssVar('--color-error'),
    brightGreen: getCssVar('--color-success'),
    brightYellow: getCssVar('--color-warning'),
    brightBlue: getCssVar('--syn-function'),
    brightMagenta: getCssVar('--syn-keyword'),
    brightCyan: getCssVar('--color-info'),
    brightWhite: '#ffffff',
  }
}

export const TerminalSurface = memo(function TerminalSurface({ session }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const fitRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null)
  const themeId = useThemeStore((s) => s.themeId)
  const scrollback = useTerminalStore((s) => s.scrollback.get(session.id) ?? '')
  const upsertSession = useTerminalStore((s) => s.upsertSession)
  const diagnostics = useTerminalStore((s) => s.diagnostics.get(session.id))
  const upsertDiagnostics = useTerminalStore((s) => s.upsertDiagnostics)
  const scrollbackRef = useRef('')
  const [isRespawning, setIsRespawning] = useState(false)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const [isDiagnosticsLoading, setIsDiagnosticsLoading] = useState(false)
  const liveLineCount = scrollback.replace(/\r/g, '') ? scrollback.replace(/\r/g, '').split('\n').length : (diagnostics?.scrollbackLineCount ?? 0)

  useEffect(() => {
    let disposed = false
    const init = async () => {
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      await import('@xterm/xterm/css/xterm.css')

      if (disposed || !containerRef.current) return

      const term = new Terminal({
        theme: buildTerminalTheme(),
        fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 13,
        lineHeight: 1.3,
        cursorBlink: true,
        cursorStyle: 'bar',
        allowProposedApi: true,
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()
      fitRef.current = fitAddon

      term.onData((data) => {
        void terminalWrite(session.id, data)
      })

      termRef.current = term

      const observer = new ResizeObserver(() => {
        if (disposed) return
        fitAddon.fit()
        void terminalResize(session.id, term.cols, term.rows).catch(() => {})
      })
      observer.observe(containerRef.current)

      return () => {
        observer.disconnect()
        term.dispose()
        termRef.current = null
        fitRef.current = null
      }
    }

    const cleanup = init()
    return () => {
      disposed = true
      cleanup.then((fn) => fn?.())
    }
  }, [session.id])

  useEffect(() => {
    if (!termRef.current) return
    const terminal = termRef.current
    const previous = scrollbackRef.current
    if (scrollback.startsWith(previous)) {
      terminal.write(scrollback.slice(previous.length))
    } else if (scrollback !== previous) {
      terminal.reset()
      terminal.write(scrollback)
    }
    scrollbackRef.current = scrollback
    fitRef.current?.fit()
  }, [scrollback])

  useEffect(() => {
    let disposed = false
    setIsDiagnosticsLoading(true)
    void terminalDiagnosticsRead(session.id)
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
  }, [session.id, upsertDiagnostics])

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (termRef.current) {
      // Small delay to let CSS vars update
      requestAnimationFrame(() => {
        if (termRef.current?.options) {
          termRef.current.options.theme = buildTerminalTheme()
        }
      })
    }
  }, [themeId])

  const onRespawn = async () => {
    setIsRespawning(true)
    setSurfaceError(null)
    try {
      const record = await terminalRespawn(session.id)
      upsertSession(toTerminalSession(record))
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Failed to restart terminal')
    } finally {
      setIsRespawning(false)
    }
  }

  const onInterrupt = async () => {
    setSurfaceError(null)
    try {
      await terminalInterrupt(session.id)
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Failed to send interrupt')
    }
  }

  const onSendEof = async () => {
    setSurfaceError(null)
    try {
      await terminalSendEof(session.id)
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Failed to send EOF')
    }
  }

  return (
    <div className={styles.surface}>
      {session.isRunning && (
        <div className={styles.actionBar}>
          <button className={styles.actionBtn} onClick={() => void onInterrupt()}>
            <Hand size={12} />
            <span>Interrupt</span>
          </button>
          <button className={styles.actionBtn} onClick={() => void onSendEof()}>
            <CornerDownLeft size={12} />
            <span>Send EOF</span>
          </button>
        </div>
      )}
      <div className={styles.diagnosticsBar}>
        <div className={styles.diagnosticPill}>
          <TerminalSquare size={12} />
          <span>{session.shellPath ?? session.shell ?? 'shell'}</span>
        </div>
        {diagnostics?.startupCommand ? (
          <div className={styles.diagnosticPill}>
            <Gauge size={12} />
            <span>{diagnostics.startupCommand}</span>
          </div>
        ) : null}
        {diagnostics ? (
          <div className={styles.diagnosticPill}>
            <History size={12} />
            <span>{liveLineCount} lines</span>
          </div>
        ) : null}
        {diagnostics?.envOverrides && Object.keys(diagnostics.envOverrides).length > 0 ? (
          <div className={styles.diagnosticPill}>
            <ShieldAlert size={12} />
            <span>{Object.keys(diagnostics.envOverrides).length} env overrides</span>
          </div>
        ) : null}
        {!session.isRunning && diagnostics?.lastExitCode !== undefined ? (
          <div className={styles.diagnosticPill}>
            <RotateCcw size={12} />
            <span>Exit {diagnostics.lastExitCode}</span>
          </div>
        ) : null}
        {!session.isRunning && diagnostics?.lastExitSignal ? (
          <div className={styles.diagnosticPill}>
            <RotateCcw size={12} />
            <span>{diagnostics.lastExitSignal}</span>
          </div>
        ) : null}
        {isDiagnosticsLoading ? <div className={styles.diagnosticsLoading}>Refreshing diagnostics...</div> : null}
      </div>
      {!session.isRunning && (
        <div className={styles.exitBanner}>
          <div className={styles.exitMeta}>
            <TerminalSquare size={14} />
            <span>
              Terminal exited{session.lastExitReason ? `: ${session.lastExitReason}` : '.'}
            </span>
          </div>
          <button className={styles.respawnBtn} onClick={() => void onRespawn()} disabled={isRespawning}>
            {isRespawning ? <Loader2 size={12} className={styles.spinner} /> : <RotateCcw size={12} />}
            <span>Respawn</span>
          </button>
        </div>
      )}
      {surfaceError && <div className={styles.errorBanner}>{surfaceError}</div>}
      <div ref={containerRef} className={styles.terminal} />
    </div>
  )
})
