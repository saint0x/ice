import { memo } from 'react'
import type { Tab } from '@/types'
import { EditorSurface } from '@/components/surfaces/EditorSurface'
import { BrowserSurface } from '@/components/surfaces/BrowserSurface'
import { TerminalSurface } from '@/components/surfaces/TerminalSurface'
import { GitSurface } from '@/components/surfaces/GitSurface'
import { CodexSurface } from '@/components/surfaces/CodexSurface'

interface Props {
  tab: Tab
}

export const ContentRenderer = memo(function ContentRenderer({ tab }: Props) {
  switch (tab.type) {
    case 'editor':
      return <EditorSurface tab={tab} />
    case 'browser':
      return <BrowserSurface tab={tab} />
    case 'terminal':
      return <TerminalSurface session={{ id: tab.id, projectId: tab.projectId, title: tab.title, cwd: '' }} />
    case 'git':
      return <GitSurface tab={tab} />
    case 'codex':
      return <CodexSurface tab={tab} />
    default:
      return <div style={{ padding: 16, color: 'var(--text-muted)' }}>Unknown content type</div>
  }
})
