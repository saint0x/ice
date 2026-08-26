import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalStore } from '@/stores/terminal'
import type { TerminalSession } from '@/types'

const liveSession: TerminalSession = {
  id: 'session-live',
  projectId: 'project-1',
  title: 'zsh',
  cwd: '/tmp/project',
  shell: 'zsh',
  shellPath: '/bin/zsh',
  isRunning: true,
}

describe('terminal scrollback retention', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: new Map(),
      activeSessionId: new Map(),
      scrollback: new Map(),
      diagnostics: new Map(),
      closedSessionIds: new Set(),
    })
  })

  it('trims oversized scrollback buffers to a bounded window', () => {
    useTerminalStore.setState({
      sessions: new Map([['session-1', {
        ...liveSession,
        id: 'session-1',
      }]]),
    })
    const largeChunk = 'x'.repeat(140 * 1024)

    useTerminalStore.getState().setScrollback('session-1', largeChunk)

    const scrollback = useTerminalStore.getState().scrollback.get('session-1') ?? ''
    expect(scrollback.length).toBe(128 * 1024)
  })

  it('reconciles active sessions, scrollback, and diagnostics to hydrated backend sessions', () => {
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

  it('ignores attempts to activate missing or cross-project terminal sessions', () => {
    useTerminalStore.setState({
      sessions: new Map([
        ['session-live', liveSession],
        ['session-other', {
          ...liveSession,
          id: 'session-other',
          projectId: 'project-2',
        }],
      ]),
      activeSessionId: new Map([['project-1', 'session-live']]),
      scrollback: new Map(),
      diagnostics: new Map(),
    })

    useTerminalStore.getState().setActiveSession('project-1', 'session-missing')
    expect(useTerminalStore.getState().activeSessionId.get('project-1')).toBe('session-live')

    useTerminalStore.getState().setActiveSession('project-1', 'session-other')
    expect(useTerminalStore.getState().activeSessionId.get('project-1')).toBe('session-live')
  })

  it('falls back to a real project session when the stored active terminal session is stale', () => {
    useTerminalStore.setState({
      sessions: new Map([['session-live', liveSession]]),
      activeSessionId: new Map([['project-1', 'session-stale']]),
      scrollback: new Map(),
      diagnostics: new Map(),
    })

    useTerminalStore.getState().setActiveSession('project-1', 'session-missing')

    expect(useTerminalStore.getState().activeSessionId.get('project-1')).toBe('session-live')
  })

  it('ignores late scrollback and diagnostics for closed terminal sessions', () => {
    useTerminalStore.getState().setScrollback('session-missing', 'late')
    useTerminalStore.getState().appendScrollback('session-missing', 'later')
    useTerminalStore.getState().clearScrollback('session-missing')
    useTerminalStore.getState().upsertDiagnostics({
      sessionId: 'session-missing',
      projectId: 'project-1',
      cwd: '/tmp/project',
      shell: 'zsh',
      shellPath: '/bin/zsh',
      title: 'zsh',
      isRunning: false,
      restoredFromPersistence: false,
      scrollbackBytes: 4,
      scrollbackLineCount: 1,
      recentLines: ['late'],
    })

    expect(useTerminalStore.getState().scrollback.has('session-missing')).toBe(false)
    expect(useTerminalStore.getState().diagnostics.has('session-missing')).toBe(false)
  })

  it('does not resurrect closed terminal sessions from late upsert events', () => {
    useTerminalStore.setState({
      sessions: new Map([['session-live', liveSession]]),
      activeSessionId: new Map([['project-1', 'session-live']]),
      scrollback: new Map([['session-live', 'output']]),
      diagnostics: new Map(),
      closedSessionIds: new Set(),
    })

    useTerminalStore.getState().closeSession('session-live')
    useTerminalStore.getState().upsertSession({ ...liveSession, title: 'late exit' })

    expect(useTerminalStore.getState().sessions.has('session-live')).toBe(false)
    expect(useTerminalStore.getState().activeSessionId.get('project-1')).toBeNull()
    expect(useTerminalStore.getState().scrollback.has('session-live')).toBe(false)
  })

  it('lets authoritative terminal hydration restore tombstoned live sessions', () => {
    useTerminalStore.setState({
      sessions: new Map(),
      activeSessionId: new Map([['project-1', null]]),
      scrollback: new Map(),
      diagnostics: new Map(),
      closedSessionIds: new Set(['session-live']),
    })

    useTerminalStore.getState().hydrateSessions([liveSession])

    const state = useTerminalStore.getState()
    expect(state.sessions.get('session-live')).toEqual(liveSession)
    expect(state.activeSessionId.get('project-1')).toBe('session-live')
    expect(state.closedSessionIds.has('session-live')).toBe(false)
  })
})
