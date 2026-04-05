import { useEffect } from 'react'
import { terminalCreate, terminalInterrupt, terminalRespawn, terminalScrollbackClear, terminalSendEof, toTerminalSession } from '@/lib/backend'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select'
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const workspace = useWorkspaceStore.getState()
      const projects = useProjectsStore.getState()
      const terminals = useTerminalStore.getState()
      const activeProjectId = projects.activeProjectId
      const activeSessionId = activeProjectId ? terminals.activeSessionId.get(activeProjectId) : null
      const activeSession = activeSessionId ? terminals.sessions.get(activeSessionId) : null
      const editable = isEditableTarget(e.target)

      if (meta && e.key === 'b') {
        e.preventDefault()
        workspace.setSidebarOpen(!workspace.sidebarOpen)
      } else if (meta && e.key === 'j') {
        e.preventDefault()
        workspace.setBottomDockOpen(!workspace.bottomDockOpen)
      } else if (meta && e.key === 'l') {
        e.preventDefault()
        workspace.setChatPanelOpen(!workspace.chatPanelOpen)
      } else if (meta && e.key === 'w') {
        e.preventDefault()
        if (workspace.layout.type === 'leaf' && workspace.layout.activeTabId) {
          workspace.closeTab(workspace.layout.id, workspace.layout.activeTabId)
        }
      } else if (meta && !e.shiftKey && e.key === '\\') {
        e.preventDefault()
        workspace.splitPane(workspace.activePaneId, 'horizontal')
      } else if (meta && e.shiftKey && e.key === '|') {
        e.preventDefault()
        workspace.splitPane(workspace.activePaneId, 'vertical')
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 't' && activeProjectId && !editable) {
        e.preventDefault()
        workspace.setBottomDockOpen(true)
        void terminalCreate(activeProjectId).then((session) => {
          const mapped = toTerminalSession(session)
          useTerminalStore.getState().upsertSession(mapped)
          useTerminalStore.getState().setActiveSession(activeProjectId, mapped.id)
        })
      } else if (meta && e.key === '.' && activeSession?.isRunning && !editable) {
        e.preventDefault()
        void terminalInterrupt(activeSession.id)
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'd' && activeSession?.isRunning && !editable) {
        e.preventDefault()
        void terminalSendEof(activeSession.id)
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'k' && activeSession && !editable) {
        e.preventDefault()
        void terminalScrollbackClear(activeSession.id).then((session) => {
          const store = useTerminalStore.getState()
          store.upsertSession(toTerminalSession(session))
          store.clearScrollback(activeSession.id)
        })
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'r' && activeSession && !activeSession.isRunning && !editable) {
        e.preventDefault()
        void terminalRespawn(activeSession.id).then((session) => {
          const mapped = toTerminalSession(session)
          const store = useTerminalStore.getState()
          store.upsertSession(mapped)
          if (activeProjectId) {
            store.setActiveSession(activeProjectId, mapped.id)
          }
        })
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
