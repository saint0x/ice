import { memo, useRef, useEffect, useState } from 'react'
import { Loader2, RotateCcw, TerminalSquare, Hand, CornerDownLeft } from 'lucide-react'
import type { TerminalSession } from '@/types'
import { terminalInterrupt, terminalResize, terminalRespawn, terminalSendEof, terminalWrite, toTerminalSession } from '@/lib/backend'
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
  const scrollbackRef = useRef('')
  const [isRespawning, setIsRespawning] = useState(false)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)

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
