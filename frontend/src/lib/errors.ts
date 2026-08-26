export function describeError(error: unknown, fallbackMessage = 'Unexpected error'): string {
  if (error instanceof Error) {
    return error.message || fallbackMessage
  }
  if (typeof error === 'string') {
    const normalized = error.trim()
    return normalized || fallbackMessage
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim()
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim()
    }
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') {
        return serialized
      }
    } catch {
      // Fall through to the generic fallback below.
    }
  }
  return fallbackMessage
}

export function describeCodexError(
  action: string,
  error: unknown,
  details?: {
    projectName?: string
    threadTitle?: string
  },
): string {
  const base = describeError(error, action)
  const context = [details?.projectName, details?.threadTitle]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' / ')

  if (!context) {
    return `${action}. ${base}`
  }
  return `${action} in ${context}. ${base}`
}
