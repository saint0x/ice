import { useEffect } from 'react'
import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  projectAdd,
  terminalCreate,
  toProject,
  toTerminalSession,
} from '@/lib/backend'
import { createAndOpenBrowserTab } from '@/lib/browserTabs'
import { useNotificationsStore } from '@/stores/notifications'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * Dispatch a semantic action to the UI. Shared with the native menu so menu
 * items and keyboard shortcuts stay in lock-step.
 */
async function dispatchMenuAction(id: string): Promise<void> {
  const workspace = useWorkspaceStore.getState()
  const projects = useProjectsStore.getState()
  const notifications = useNotificationsStore.getState()
  const activeProjectId = projects.activeProjectId
  const activeProject = activeProjectId ? projects.projects.get(activeProjectId) : null
  const requireActiveProject = (actionLabel: string): string | null => {
    if (activeProjectId) return activeProjectId
    notifications.pushNotification({
      title: 'Select a project first',
      message: `Open or add a project to use ${actionLabel}.`,
      level: 'info',
    })
    return null
  }

  switch (id) {
    case 'file.add_project': {
      try {
        const selection = await openDialog({
          directory: true,
          multiple: false,
          title: 'Select a project folder',
        })
        if (typeof selection === 'string' && selection.length > 0) {
          const created = await projectAdd(selection, true)
          const mapped = toProject(created)
          projects.addProject(mapped)
          projects.setActiveProject(mapped.id)
        }
      } catch (error) {
        notifications.pushError('Project add failed', error, 'Failed to add project')
      }
      return
    }
    case 'file.new_terminal': {
      const projectId = requireActiveProject('the terminal')
      if (!projectId) return
      workspace.setBottomDockOpen(true)
      try {
        const session = await terminalCreate(projectId)
        const mapped = toTerminalSession(session)
        useTerminalStore.getState().upsertSession(mapped)
        useTerminalStore.getState().setActiveSession(projectId, mapped.id)
      } catch (error) {
        notifications.pushError('Terminal create failed', error, 'Failed to create terminal')
      }
      return
    }
    case 'file.new_browser_tab': {
      const projectId = requireActiveProject('a browser tab')
      if (!projectId) return
      try {
        await createAndOpenBrowserTab(projectId)
      } catch (error) {
        notifications.pushError('Browser tab failed', error, 'Failed to create browser tab')
      }
      return
    }
    case 'file.save': {
      window.dispatchEvent(new CustomEvent('ice:menu:save'))
      return
    }
    case 'file.close_tab': {
      const layout = workspace.layout
      const activePaneId = workspace.activePaneId
      const findActive = (node: typeof layout): string | null => {
        if (node.type === 'leaf') return node.id === activePaneId ? node.activeTabId : null
        for (const child of node.children) {
          const found = findActive(child)
          if (found) return found
        }
        return null
      }
      const activeTabId = findActive(layout)
      if (activeTabId) workspace.closeTab(activePaneId, activeTabId)
      return
    }
    case 'edit.find': {
      window.dispatchEvent(new CustomEvent('ice:menu:find'))
      return
    }
    case 'edit.find_in_project': {
      if (!activeProjectId || !activeProject) {
        requireActiveProject('project search')
        return
      }
      workspace.openTab(
        workspace.activePaneId,
        'settings',
        `${activeProject.name} Search`,
        activeProjectId,
        { tool: 'search' }
      )
      return
    }
    case 'view.toggle_sidebar':
      workspace.setSidebarOpen(!workspace.sidebarOpen)
      return
    case 'view.toggle_dock':
      workspace.setBottomDockOpen(!workspace.bottomDockOpen)
      return
    case 'view.toggle_chat':
      workspace.setChatPanelOpen(!workspace.chatPanelOpen)
      return
    case 'view.files':
      if (!activeProjectId || !activeProject) {
        requireActiveProject('Files')
        return
      }
      workspace.openTab(
        workspace.activePaneId,
        'settings',
        `${activeProject.name} Files`,
        activeProjectId,
        { tool: 'files' }
      )
      return
    case 'view.search':
      if (!activeProjectId || !activeProject) {
        requireActiveProject('Search')
        return
      }
      workspace.openTab(
        workspace.activePaneId,
        'settings',
        `${activeProject.name} Search`,
        activeProjectId,
        { tool: 'search' }
      )
      return
    case 'view.git':
      if (!activeProjectId || !activeProject) {
        requireActiveProject('Git')
        return
      }
      workspace.openTab(
        workspace.activePaneId,
        'git',
        `${activeProject.name} Git`,
        activeProjectId
      )
      return
    case 'view.split_horizontal':
      workspace.splitPane(workspace.activePaneId, 'horizontal')
      return
    case 'view.split_vertical':
      workspace.splitPane(workspace.activePaneId, 'vertical')
      return
    case 'help.docs':
      window.dispatchEvent(new CustomEvent('ice:menu:docs'))
      return
    default:
      return
  }
}

export function useMenuEvents(): void {
  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    let cancelled = false
    void listen<string>('app://menu', (event: Event<string>) => {
      void dispatchMenuAction(event.payload)
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  }, [])
}
