import { create } from 'zustand'
import type { TerminalSession, TerminalDiagnostics, TerminalId, ProjectId } from '@/types'

interface TerminalState {
  sessions: Map<TerminalId, TerminalSession>
  activeSessionId: Map<ProjectId, TerminalId | null>
  scrollback: Map<TerminalId, string>
  diagnostics: Map<TerminalId, TerminalDiagnostics>

  hydrateSessions: (sessions: TerminalSession[]) => void
  upsertSession: (session: TerminalSession) => void
  upsertDiagnostics: (diagnostics: TerminalDiagnostics) => void
  setScrollback: (id: TerminalId, content: string) => void
  appendScrollback: (id: TerminalId, chunk: string) => void
  clearScrollback: (id: TerminalId) => void
  closeSession: (id: TerminalId) => void
  setActiveSession: (projectId: ProjectId, id: TerminalId) => void
  renameSession: (id: TerminalId, title: string) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  sessions: new Map(),
  activeSessionId: new Map(),
  scrollback: new Map(),
  diagnostics: new Map(),

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

  upsertDiagnostics: (diagnostics) =>
    set((s) => {
      const next = new Map(s.diagnostics)
      next.set(diagnostics.sessionId, diagnostics)
      return { diagnostics: next }
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

  clearScrollback: (id) =>
    set((s) => {
      const scrollback = new Map(s.scrollback)
      scrollback.set(id, '')
      return { scrollback }
    }),

  closeSession: (id) =>
    set((s) => {
      const sessions = new Map(s.sessions)
      const session = sessions.get(id)
      sessions.delete(id)
      const scrollback = new Map(s.scrollback)
      scrollback.delete(id)
      const diagnostics = new Map(s.diagnostics)
      diagnostics.delete(id)
      if (session) {
        const activeSessionId = new Map(s.activeSessionId)
        if (activeSessionId.get(session.projectId) === id) {
          const remaining = [...sessions.values()].filter((s) => s.projectId === session.projectId)
          activeSessionId.set(session.projectId, remaining[0]?.id ?? null)
        }
        return { sessions, activeSessionId, scrollback, diagnostics }
      }
      return { sessions, scrollback, diagnostics }
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
