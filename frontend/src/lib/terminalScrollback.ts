import { terminalScrollbackRead } from '@/lib/backend'
import { useTerminalStore } from '@/stores/terminal'

const inflightScrollbackLoads = new Map<string, Promise<string>>()

export async function ensureTerminalScrollback(sessionId: string, options?: { force?: boolean }) {
  const store = useTerminalStore.getState()
  if (!options?.force && store.scrollback.has(sessionId)) {
    return store.scrollback.get(sessionId) ?? ''
  }

  const existing = inflightScrollbackLoads.get(sessionId)
  if (existing) {
    return existing
  }

  const loadPromise = terminalScrollbackRead(sessionId)
    .then((result) => {
      useTerminalStore.getState().setScrollback(sessionId, result.content)
      return result.content
    })
    .finally(() => {
      inflightScrollbackLoads.delete(sessionId)
    })

  inflightScrollbackLoads.set(sessionId, loadPromise)
  return loadPromise
}
