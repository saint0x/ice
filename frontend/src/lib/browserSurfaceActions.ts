interface BrowserSurfaceActionHandlers<T> {
  title: string
  fallbackMessage: string
  setSurfaceError: (message: string | null) => void
  pushError: (title: string, error: unknown, fallbackMessage?: string) => string
  onSuccess?: (value: T) => void
}

export async function runBrowserSurfaceAction<T>(
  action: Promise<T>,
  handlers: BrowserSurfaceActionHandlers<T>,
): Promise<T | null> {
  handlers.setSurfaceError(null)
  try {
    const value = await action
    handlers.onSuccess?.(value)
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : handlers.fallbackMessage
    handlers.setSurfaceError(message)
    handlers.pushError(handlers.title, error, message)
    return null
  }
}
