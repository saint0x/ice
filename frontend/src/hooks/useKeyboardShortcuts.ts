import { useEffect } from 'react'
import { terminalCreate, terminalInterrupt, terminalRespawn, terminalScrollbackClear, terminalSendEof, toTerminalSession } from '@/lib/backend'
import { createAndOpenBrowserTab } from '@/lib/browserTabs'
import { useNotificationsStore } from '@/stores/notifications'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select'
}

function findPaneTabs(layout: ReturnType<typeof useWorkspaceStore.getState>['layout'], paneId: string): string[] {
  if (layout.type === 'leaf') {
    return layout.id === paneId ? layout.tabs : []
  }
  for (const child of layout.children) {
    const tabs = findPaneTabs(child, paneId)
    if (tabs.length > 0) return tabs
  }
  return []
}

function findActiveTabId(layout: ReturnType<typeof useWorkspaceStore.getState>['layout'], paneId: string): string | null {
  if (layout.type === 'leaf') {
    return layout.id === paneId ? layout.activeTabId : null
  }
  for (const child of layout.children) {
    const activeTabId = findActiveTabId(child, paneId)
    if (activeTabId) return activeTabId
  }
  return null
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const workspace = useWorkspaceStore.getState()
      const projects = useProjectsStore.getState()
      const terminals = useTerminalStore.getState()
      const notifications = useNotificationsStore.getState()
      const activeProjectId = projects.activeProjectId
      const activeProject = activeProjectId ? projects.projects.get(activeProjectId) : null
      const activeSessionId = activeProjectId ? terminals.activeSessionId.get(activeProjectId) : null
      const activeSession = activeSessionId ? terminals.sessions.get(activeSessionId) : null
      const activePaneTabs = findPaneTabs(workspace.layout, workspace.activePaneId)
      const activePaneTabId = findActiveTabId(workspace.layout, workspace.activePaneId)
      const activeTabIndex = activePaneTabs.findIndex((tabId) => tabId === activePaneTabId)
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
        const activePaneTabs = findPaneTabs(workspace.layout, workspace.activePaneId)
        const activeTabId = (() => {
          if (workspace.layout.type === 'leaf' && workspace.layout.id === workspace.activePaneId) {
            return workspace.layout.activeTabId
          }
          return activePaneTabs[activePaneTabs.length - 1] ?? null
        })()
        if (activeTabId) {
          workspace.closeTab(workspace.activePaneId, activeTabId)
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
      } else if (meta && e.altKey && e.key === 'ArrowRight' && activePaneTabs.length > 1 && !editable) {
        e.preventDefault()
        const nextIndex = activeTabIndex >= 0 ? (activeTabIndex + 1) % activePaneTabs.length : 0
        workspace.activateTab(workspace.activePaneId, activePaneTabs[nextIndex]!)
      } else if (meta && e.altKey && e.key === 'ArrowLeft' && activePaneTabs.length > 1 && !editable) {
        e.preventDefault()
        const nextIndex = activeTabIndex >= 0 ? (activeTabIndex - 1 + activePaneTabs.length) % activePaneTabs.length : 0
        workspace.activateTab(workspace.activePaneId, activePaneTabs[nextIndex]!)
      } else if (meta && e.altKey && e.key === 'ArrowDown' && activeProjectId && !editable) {
        e.preventDefault()
        const currentIndex = projects.projectOrder.indexOf(activeProjectId)
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % projects.projectOrder.length : 0
        const nextProjectId = projects.projectOrder[nextIndex]
        if (nextProjectId) projects.setActiveProject(nextProjectId)
      } else if (meta && e.altKey && e.key === 'ArrowUp' && activeProjectId && !editable) {
        e.preventDefault()
        const currentIndex = projects.projectOrder.indexOf(activeProjectId)
        const nextIndex = currentIndex >= 0 ? (currentIndex - 1 + projects.projectOrder.length) % projects.projectOrder.length : 0
        const nextProjectId = projects.projectOrder[nextIndex]
        if (nextProjectId) projects.setActiveProject(nextProjectId)
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'f' && activeProjectId && activeProject && !editable) {
        e.preventDefault()
        workspace.openTab(workspace.activePaneId, 'settings', `${activeProject.name} Files`, activeProjectId, { tool: 'files' })
      } else if (meta && e.altKey && e.key.toLowerCase() === 'f' && activeProjectId && activeProject && !editable) {
        e.preventDefault()
        workspace.openTab(workspace.activePaneId, 'settings', `${activeProject.name} Search`, activeProjectId, { tool: 'search' })
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'g' && activeProjectId && activeProject && !editable) {
        e.preventDefault()
        workspace.openTab(workspace.activePaneId, 'git', `${activeProject.name} Git`, activeProjectId)
      } else if (meta && e.altKey && e.key.toLowerCase() === 'b' && activeProjectId && !editable) {
        e.preventDefault()
        void createAndOpenBrowserTab(activeProjectId)
          .catch((error: unknown) => {
            notifications.pushError('Browser tab failed', error, 'Failed to create browser tab')
          })
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
