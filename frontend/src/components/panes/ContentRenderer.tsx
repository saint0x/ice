import { memo } from 'react'
import type { Tab } from '@/types'
import { EditorSurface } from '@/components/surfaces/EditorSurface'
import { BrowserSurface } from '@/components/surfaces/BrowserSurface'
import { TerminalSurface } from '@/components/surfaces/TerminalSurface'
import { GitSurface } from '@/components/surfaces/GitSurface'
import { CodexSurface } from '@/components/surfaces/CodexSurface'
import { useTerminalStore } from '@/stores/terminal'

interface Props {
  tab: Tab
}

export const ContentRenderer = memo(function ContentRenderer({ tab }: Props) {
  const terminalSession = useTerminalStore((s) => {
    const sessionId = (tab.meta?.sessionId as string | undefined) ?? tab.id
    return s.sessions.get(sessionId)
  })
  switch (tab.type) {
    case 'editor':
      return <EditorSurface tab={tab} />
    case 'browser':
      return <BrowserSurface tab={tab} />
    case 'terminal':
      return terminalSession
        ? <TerminalSurface session={terminalSession} />
        : <div style={{ padding: 16, color: 'var(--text-muted)' }}>Terminal session unavailable</div>
    case 'git':
      return <GitSurface tab={tab} />
    case 'codex':
      return <CodexSurface tab={tab} />
    default:
      return <div style={{ padding: 16, color: 'var(--text-muted)' }}>Unknown content type</div>
  }
})
