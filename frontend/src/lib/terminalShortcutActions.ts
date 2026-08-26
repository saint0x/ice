interface TerminalShortcutActionHandlers<T> {
  title: string
  fallbackMessage: string
  pushError: (title: string, error: unknown, fallbackMessage?: string) => string
  onSuccess?: (value: T) => void
}

export async function runTerminalShortcutAction<T>(
  action: Promise<T>,
  handlers: TerminalShortcutActionHandlers<T>,
): Promise<T | null> {
  try {
    const value = await action
    handlers.onSuccess?.(value)
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : handlers.fallbackMessage
    handlers.pushError(handlers.title, error, message)
    return null
  }
}
