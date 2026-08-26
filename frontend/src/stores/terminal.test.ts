import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalStore } from '@/stores/terminal'

describe('terminal scrollback retention', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: new Map(),
      activeSessionId: new Map(),
      scrollback: new Map(),
      diagnostics: new Map(),
    })
  })

  it('trims oversized scrollback buffers to a bounded window', () => {
    const largeChunk = 'x'.repeat(140 * 1024)

    useTerminalStore.getState().setScrollback('session-1', largeChunk)

    const scrollback = useTerminalStore.getState().scrollback.get('session-1') ?? ''
    expect(scrollback.length).toBe(128 * 1024)
  })

  it('reconciles active sessions, scrollback, and diagnostics to hydrated backend sessions', () => {
    const liveSession = {
      id: 'session-live',
      projectId: 'project-1',
      title: 'zsh',
      cwd: '/tmp/project',
      shell: 'zsh',
      shellPath: '/bin/zsh',
      isRunning: true,
    }
    useTerminalStore.setState({
      sessions: new Map([
        ['session-stale', {
          ...liveSession,
          id: 'session-stale',
        }],
      ]),
      activeSessionId: new Map([
        ['project-1', 'session-stale'],
        ['project-2', 'session-missing'],
      ]),
      scrollback: new Map([
        ['session-stale', 'old'],
        ['session-live', 'current'],
      ]),
      diagnostics: new Map([
        ['session-stale', {
          sessionId: 'session-stale',
          projectId: 'project-1',
          cwd: '/tmp/project',
          shell: 'zsh',
          shellPath: '/bin/zsh',
          title: 'zsh',
          isRunning: true,
          restoredFromPersistence: false,
          scrollbackBytes: 3,
          scrollbackLineCount: 1,
          recentLines: ['old'],
        }],
      ]),
    })

    useTerminalStore.getState().hydrateSessions([liveSession])

    const state = useTerminalStore.getState()
    expect(state.sessions.has('session-stale')).toBe(false)
    expect(state.activeSessionId.get('project-1')).toBe('session-live')
    expect(state.activeSessionId.get('project-2')).toBeNull()
    expect(state.scrollback.has('session-stale')).toBe(false)
    expect(state.scrollback.get('session-live')).toBe('current')
    expect(state.diagnostics.has('session-stale')).toBe(false)
  })
})
