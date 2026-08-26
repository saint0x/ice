import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureTerminalScrollback } from '@/lib/terminalScrollback'
import { terminalScrollbackRead } from '@/lib/backend'
import { useTerminalStore } from '@/stores/terminal'

vi.mock('@/lib/backend', () => ({
  terminalScrollbackRead: vi.fn(),
}))

const session = {
  id: 'session-live',
  projectId: 'project-a',
  title: 'zsh',
  cwd: '/tmp/project',
  shell: 'zsh',
  shellPath: '/bin/zsh',
  isRunning: true,
}

describe('terminal scrollback hydration', () => {
  beforeEach(() => {
    vi.mocked(terminalScrollbackRead).mockReset()
    useTerminalStore.setState({
      sessions: new Map([[session.id, session]]),
      activeSessionId: new Map([['project-a', session.id]]),
      scrollback: new Map(),
      diagnostics: new Map(),
      closedSessionIds: new Set(),
      removedProjectIds: new Set(),
    })
  })

  it('loads scrollback once and caches it in terminal state', async () => {
    vi.mocked(terminalScrollbackRead).mockResolvedValueOnce({
      sessionId: session.id,
      content: 'line 1\n',
    })

    await expect(ensureTerminalScrollback(session.id)).resolves.toBe('line 1\n')
    await expect(ensureTerminalScrollback(session.id)).resolves.toBe('line 1\n')

    expect(terminalScrollbackRead).toHaveBeenCalledTimes(1)
    expect(useTerminalStore.getState().scrollback.get(session.id)).toBe('line 1\n')
  })

  it('does not overwrite live output with a stale in-flight backend snapshot', async () => {
    let resolveRead: (value: Awaited<ReturnType<typeof terminalScrollbackRead>>) => void = () => {}
    vi.mocked(terminalScrollbackRead).mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve
    }))

    const pending = ensureTerminalScrollback(session.id)
    useTerminalStore.getState().appendScrollback(session.id, 'live output\n')
    resolveRead({
      sessionId: session.id,
      content: 'old persisted output\n',
    })

    await expect(pending).resolves.toBe('old persisted output\n')
    expect(useTerminalStore.getState().scrollback.get(session.id)).toBe('live output\n')
  })

  it('accepts a backend snapshot that extends the current live output', async () => {
    useTerminalStore.getState().appendScrollback(session.id, 'line 1\n')
    vi.mocked(terminalScrollbackRead).mockResolvedValueOnce({
      sessionId: session.id,
      content: 'line 1\nline 2\n',
    })

    await expect(ensureTerminalScrollback(session.id, { force: true })).resolves.toBe('line 1\nline 2\n')

    expect(useTerminalStore.getState().scrollback.get(session.id)).toBe('line 1\nline 2\n')
  })
})
