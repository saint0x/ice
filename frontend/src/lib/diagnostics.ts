import { invoke } from '@tauri-apps/api/core'

type FrontendLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

let startupCounter = 0

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return { value: String(error) }
}

export async function logFrontendEvent(
  level: FrontendLogLevel,
  scope: string,
  message: string,
  context?: Record<string, unknown>,
) {
  try {
    await invoke('diagnostics_frontend_log', {
      input: {
        level,
        scope,
        message,
        context: context ?? null,
      },
    })
  } catch {
    // Logging must never break the app.
  }
}

export function installFrontendDiagnostics() {
  const bootId = ++startupCounter
  void logFrontendEvent('info', 'frontend.bootstrap', 'frontend startup begin', {
    bootId,
    href: window.location.href,
    userAgent: window.navigator.userAgent,
  })

  window.addEventListener('error', (event) => {
    void logFrontendEvent('fatal', 'window.error', event.message || 'Unhandled window error', {
      bootId,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: normalizeError(event.error),
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    void logFrontendEvent('fatal', 'window.unhandledrejection', 'Unhandled promise rejection', {
      bootId,
      reason: normalizeError(event.reason),
    })
  })

  return bootId
}
