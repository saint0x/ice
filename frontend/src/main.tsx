import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppShell } from '@/components/shell/AppShell'
import { FatalScreen } from '@/components/shell/FatalScreen'
import { installFrontendDiagnostics, logFrontendEvent } from '@/lib/diagnostics'
import '@/styles/global.css'

const bootId = installFrontendDiagnostics()
const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Missing #root element')
}

try {
  void logFrontendEvent('info', 'frontend.bootstrap', 'react root render begin', { bootId })
  createRoot(rootElement).render(
    <StrictMode>
      <AppShell />
    </StrictMode>
  )
  void logFrontendEvent('info', 'frontend.bootstrap', 'react root render scheduled', { bootId })
} catch (error) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
  void logFrontendEvent('fatal', 'frontend.bootstrap', 'react root render failed', {
    bootId,
    error: detail,
  })
  createRoot(rootElement).render(
    <FatalScreen
      title="A startup error prevented the UI from rendering."
      detail={detail}
    />
  )
}
