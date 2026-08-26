import { lazy, memo, Suspense } from 'react'
import type { Tab } from '@/types'
import { useTerminalStore } from '@/stores/terminal'

const EditorSurface = lazy(() => import('@/components/surfaces/EditorSurface').then((module) => ({ default: module.EditorSurface })))
const BrowserSurface = lazy(() => import('@/components/surfaces/BrowserSurface').then((module) => ({ default: module.BrowserSurface })))
const TerminalSurface = lazy(() => import('@/components/surfaces/TerminalSurface').then((module) => ({ default: module.TerminalSurface })))
const GitSurface = lazy(() => import('@/components/surfaces/GitSurface').then((module) => ({ default: module.GitSurface })))
const CodexSurface = lazy(() => import('@/components/surfaces/CodexSurface').then((module) => ({ default: module.CodexSurface })))
const SettingsSurface = lazy(() => import('@/components/surfaces/SettingsSurface').then((module) => ({ default: module.SettingsSurface })))

interface Props {
  tab: Tab
}

export const ContentRenderer = memo(function ContentRenderer({ tab }: Props) {
  const terminalSession = useTerminalStore((s) => {
    const sessionId = (tab.meta?.sessionId as string | undefined) ?? tab.id
    return s.sessions.get(sessionId)
  })
  return (
    <Suspense fallback={<SurfaceFallback label="Loading surface" />}>
      {(() => {
        switch (tab.type) {
          case 'editor':
            return <EditorSurface tab={tab} />
          case 'browser':
            return <BrowserSurface tab={tab} />
          case 'terminal':
            return terminalSession
              ? <TerminalSurface session={terminalSession} />
              : <SurfaceFallback label="Terminal session unavailable" />
          case 'git':
            return <GitSurface tab={tab} />
          case 'codex':
            return <CodexSurface tab={tab} />
          case 'settings':
            return <SettingsSurface tab={tab} />
          default:
            return <SurfaceFallback label="Unknown content type" />
        }
      })()}
    </Suspense>
  )
})

function SurfaceFallback({ label }: { label: string }) {
  return <div style={{ padding: 16, color: 'var(--text-muted)' }}>{label}</div>
}
