import { useEffect } from 'react'
import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  browserTabCreate,
  projectAdd,
  terminalCreate,
  toBrowserTab,
  toProject,
  toTerminalSession,
} from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
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
      if (!activeProjectId) return
      workspace.setBottomDockOpen(true)
      try {
        const session = await terminalCreate(activeProjectId)
        const mapped = toTerminalSession(session)
        useTerminalStore.getState().upsertSession(mapped)
        useTerminalStore.getState().setActiveSession(activeProjectId, mapped.id)
      } catch (error) {
        notifications.pushError('Terminal create failed', error, 'Failed to create terminal')
      }
      return
    }
    case 'file.new_browser_tab': {
      if (!activeProjectId) return
      try {
        const tab = await browserTabCreate(activeProjectId, 'https://localhost:3000')
        const mapped = toBrowserTab(tab)
        const browserStore = useBrowserStore.getState()
        browserStore.upsertTab(mapped)
        browserStore.setActiveTab(activeProjectId, mapped.id)
        workspace.openTab(workspace.activePaneId, 'browser', mapped.title, activeProjectId, {
          tabId: mapped.id,
          url: mapped.url,
        })
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
      if (!activeProjectId || !activeProject) return
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
      if (activeProjectId && activeProject) {
        workspace.openTab(
          workspace.activePaneId,
          'settings',
          `${activeProject.name} Files`,
          activeProjectId,
          { tool: 'files' }
        )
      }
      return
    case 'view.search':
      if (activeProjectId && activeProject) {
        workspace.openTab(
          workspace.activePaneId,
          'settings',
          `${activeProject.name} Search`,
          activeProjectId,
          { tool: 'search' }
        )
      }
      return
    case 'view.git':
      if (activeProjectId && activeProject) {
        workspace.openTab(
          workspace.activePaneId,
          'git',
          `${activeProject.name} Git`,
          activeProjectId
        )
      }
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
