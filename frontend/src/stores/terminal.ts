import { create } from 'zustand'
import type { TerminalSession, TerminalId, ProjectId } from '@/types'

interface TerminalState {
  sessions: Map<TerminalId, TerminalSession>
  activeSessionId: Map<ProjectId, TerminalId | null>
  scrollback: Map<TerminalId, string>

  hydrateSessions: (sessions: TerminalSession[]) => void
  upsertSession: (session: TerminalSession) => void
  setScrollback: (id: TerminalId, content: string) => void
  appendScrollback: (id: TerminalId, chunk: string) => void
  createSession: (projectId: ProjectId, title?: string) => TerminalId
  closeSession: (id: TerminalId) => void
  setActiveSession: (projectId: ProjectId, id: TerminalId) => void
  renameSession: (id: TerminalId, title: string) => void
}

let _counter = 0

export const useTerminalStore = create<TerminalState>((set) => ({
  sessions: new Map([
    ['term-1', { id: 'term-1', projectId: 'proj-1', title: 'zsh', cwd: '/Users/deepsaint/Desktop/ice' }],
    ['term-2', { id: 'term-2', projectId: 'proj-1', title: 'build', cwd: '/Users/deepsaint/Desktop/ice' }],
  ]),
  activeSessionId: new Map([['proj-1', 'term-1']]),
  scrollback: new Map(),

  hydrateSessions: (sessions) =>
    set((s) => {
      const nextSessions = new Map<TerminalId, TerminalSession>()
      const nextActiveSessionId = new Map(s.activeSessionId)
      for (const session of sessions) {
        nextSessions.set(session.id, session)
      }
      const projectIds = new Set<string>(sessions.map((session) => session.projectId))
      for (const projectId of projectIds) {
        const activeId = nextActiveSessionId.get(projectId)
        const projectSessions = sessions.filter((session) => session.projectId === projectId)
        if (!activeId || !nextSessions.has(activeId)) {
          nextActiveSessionId.set(projectId, projectSessions[0]?.id ?? null)
        }
      }
      return { sessions: nextSessions, activeSessionId: nextActiveSessionId }
    }),

  upsertSession: (session) =>
    set((s) => {
      const sessions = new Map(s.sessions)
      sessions.set(session.id, session)
      const activeSessionId = new Map(s.activeSessionId)
      if (!activeSessionId.get(session.projectId)) {
        activeSessionId.set(session.projectId, session.id)
      }
      return { sessions, activeSessionId }
    }),

  setScrollback: (id, content) =>
    set((s) => {
      const scrollback = new Map(s.scrollback)
      scrollback.set(id, content)
      return { scrollback }
    }),

  appendScrollback: (id, chunk) =>
    set((s) => {
      const scrollback = new Map(s.scrollback)
      scrollback.set(id, `${scrollback.get(id) ?? ''}${chunk}`)
      return { scrollback }
    }),

  createSession: (projectId, title) => {
    const id: TerminalId = `term-${++_counter + 100}`
    const session: TerminalSession = {
      id,
      projectId,
      title: title ?? 'zsh',
      cwd: '',
    }
    set((s) => {
      const sessions = new Map(s.sessions)
      sessions.set(id, session)
      const activeSessionId = new Map(s.activeSessionId)
      activeSessionId.set(projectId, id)
      return { sessions, activeSessionId }
    })
    return id
  },

  closeSession: (id) =>
    set((s) => {
      const sessions = new Map(s.sessions)
      const session = sessions.get(id)
      sessions.delete(id)
      const scrollback = new Map(s.scrollback)
      scrollback.delete(id)
      if (session) {
        const activeSessionId = new Map(s.activeSessionId)
        if (activeSessionId.get(session.projectId) === id) {
          const remaining = [...sessions.values()].filter((s) => s.projectId === session.projectId)
          activeSessionId.set(session.projectId, remaining[0]?.id ?? null)
        }
        return { sessions, activeSessionId, scrollback }
      }
      return { sessions, scrollback }
    }),

  setActiveSession: (projectId, id) =>
    set((s) => {
      const activeSessionId = new Map(s.activeSessionId)
      activeSessionId.set(projectId, id)
      return { activeSessionId }
    }),

  renameSession: (id, title) =>
    set((s) => {
      const sessions = new Map(s.sessions)
      const session = sessions.get(id)
      if (!session) return s
      sessions.set(id, { ...session, title })
      return { sessions }
    }),
}))
