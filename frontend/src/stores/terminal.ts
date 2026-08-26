import { create } from 'zustand'
import type { TerminalSession, TerminalDiagnostics, TerminalId, ProjectId } from '@/types'

const MAX_SCROLLBACK_CHARS = 128 * 1024

function trimScrollback(content: string) {
  if (content.length <= MAX_SCROLLBACK_CHARS) {
    return content
  }
  return content.slice(content.length - MAX_SCROLLBACK_CHARS)
}

interface TerminalState {
  sessions: Map<TerminalId, TerminalSession>
  activeSessionId: Map<ProjectId, TerminalId | null>
  scrollback: Map<TerminalId, string>
  diagnostics: Map<TerminalId, TerminalDiagnostics>
  closedSessionIds: Set<TerminalId>

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
  closedSessionIds: new Set(),

  hydrateSessions: (sessions) =>
    set((s) => {
      const nextSessions = new Map<TerminalId, TerminalSession>()
      const nextActiveSessionId = new Map(s.activeSessionId)
      const closedSessionIds = new Set(s.closedSessionIds)
      const sessionsByProject = new Map<ProjectId, TerminalSession[]>()
      for (const session of sessions) {
        nextSessions.set(session.id, session)
        closedSessionIds.delete(session.id)
        sessionsByProject.set(session.projectId, [...(sessionsByProject.get(session.projectId) ?? []), session])
      }
      const projectIds = new Set<string>([
        ...sessionsByProject.keys(),
        ...nextActiveSessionId.keys(),
      ])
      for (const projectId of projectIds) {
        const activeId = nextActiveSessionId.get(projectId)
        const projectSessions = sessionsByProject.get(projectId) ?? []
        if (projectSessions.length === 0) {
          nextActiveSessionId.delete(projectId)
          continue
        }
        if (!activeId || !nextSessions.has(activeId)) {
          nextActiveSessionId.set(projectId, projectSessions[0]!.id)
        }
      }
      const scrollback = new Map(s.scrollback)
      for (const sessionId of scrollback.keys()) {
        if (!nextSessions.has(sessionId)) {
          scrollback.delete(sessionId)
        }
      }
      const diagnostics = new Map(s.diagnostics)
      for (const sessionId of diagnostics.keys()) {
        if (!nextSessions.has(sessionId)) {
          diagnostics.delete(sessionId)
        }
      }
      return { sessions: nextSessions, activeSessionId: nextActiveSessionId, scrollback, diagnostics, closedSessionIds }
    }),

  upsertSession: (session) =>
    set((s) => {
      if (s.closedSessionIds.has(session.id)) return {}
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
      if (!s.sessions.has(diagnostics.sessionId)) return {}
      const next = new Map(s.diagnostics)
      next.set(diagnostics.sessionId, diagnostics)
      return { diagnostics: next }
    }),

  setScrollback: (id, content) =>
    set((s) => {
      if (!s.sessions.has(id)) return {}
      const scrollback = new Map(s.scrollback)
      scrollback.set(id, trimScrollback(content))
      return { scrollback }
    }),

  appendScrollback: (id, chunk) =>
    set((s) => {
      if (!s.sessions.has(id)) return {}
      const scrollback = new Map(s.scrollback)
      scrollback.set(id, trimScrollback(`${scrollback.get(id) ?? ''}${chunk}`))
      return { scrollback }
    }),

  clearScrollback: (id) =>
    set((s) => {
      if (!s.sessions.has(id)) return {}
      const scrollback = new Map(s.scrollback)
      scrollback.set(id, '')
      return { scrollback }
    }),

  closeSession: (id) =>
    set((s) => {
      const sessions = new Map(s.sessions)
      const session = sessions.get(id)
      sessions.delete(id)
      const closedSessionIds = new Set(s.closedSessionIds)
      closedSessionIds.add(id)
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
        return { sessions, activeSessionId, scrollback, diagnostics, closedSessionIds }
      }
      return { sessions, scrollback, diagnostics, closedSessionIds }
    }),

  setActiveSession: (projectId, id) =>
    set((s) => {
      const session = s.sessions.get(id)
      const activeSessionId = new Map(s.activeSessionId)
      if (!session || session.projectId !== projectId) {
        const currentId = activeSessionId.get(projectId)
        const currentSession = currentId ? s.sessions.get(currentId) : undefined
        if (currentSession?.projectId === projectId) {
          return {}
        }
        const fallback = [...s.sessions.values()].find((candidate) => candidate.projectId === projectId)
        activeSessionId.set(projectId, fallback?.id ?? null)
        return { activeSessionId }
      }
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
