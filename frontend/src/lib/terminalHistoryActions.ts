interface CopyTerminalHistoryInput {
  sessionId: string | null
  readScrollback: (sessionId: string) => Promise<string>
  writeClipboard: (text: string) => Promise<void>
  setSurfaceError: (message: string | null) => void
  pushError: (title: string, error: unknown, fallbackMessage?: string) => string
}

export async function copyTerminalHistory(input: CopyTerminalHistoryInput) {
  if (!input.sessionId) {
    return false
  }

  try {
    const scrollback = await input.readScrollback(input.sessionId)
    await input.writeClipboard(scrollback)
    input.setSurfaceError(null)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to copy terminal history'
    input.setSurfaceError(message)
    input.pushError('Terminal history copy failed', error, message)
    return false
  }
}
