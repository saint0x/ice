import { memo, useRef, useEffect } from 'react'
import type { TerminalSession } from '@/types'
import { useThemeStore } from '@/stores/theme'
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
  const themeId = useThemeStore((s) => s.themeId)

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

      term.writeln(`\x1b[38;5;244m❯ \x1b[0m${session.title} — ${session.cwd || 'ready'}`)
      term.writeln('')
      term.write('\x1b[38;5;244m❯ \x1b[0m')

      termRef.current = term

      const observer = new ResizeObserver(() => {
        if (!disposed) fitAddon.fit()
      })
      observer.observe(containerRef.current)

      return () => {
        observer.disconnect()
        term.dispose()
        termRef.current = null
      }
    }

    const cleanup = init()
    return () => {
      disposed = true
      cleanup.then((fn) => fn?.())
    }
  }, [session.id, session.title, session.cwd])

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

  return (
    <div className={styles.surface}>
      <div ref={containerRef} className={styles.terminal} />
    </div>
  )
})
