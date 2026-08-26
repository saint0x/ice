import { useBrowserStore } from '@/stores/browser'
import { useCodexStore } from '@/stores/codex'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useGitStore } from '@/stores/git'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import { closeWorkspaceTabsForProject } from '@/lib/workspaceTabs'

export function removeProjectLocalState(projectId: string) {
  useProjectsStore.getState().removeProject(projectId)
  closeWorkspaceTabsForProject(projectId)

  useFilesStore.setState((state) => {
    const trees = new Map(state.trees)
    trees.delete(projectId)
    const selectedPath = new Map(state.selectedPath)
    selectedPath.delete(projectId)
    return { trees, selectedPath }
  })

  useGitStore.setState((state) => {
    const gitState = new Map(state.gitState)
    gitState.delete(projectId)
    const lastMutation = new Map(state.lastMutation)
    lastMutation.delete(projectId)
    return { gitState, lastMutation }
  })

  useBrowserStore.setState((state) => {
    const tabs = new Map(state.tabs)
    const runtimeNotices = new Map(state.runtimeNotices)
    const closedTabIds = new Set(state.closedTabIds)
    for (const tab of tabs.values()) {
      if (tab.projectId === projectId) {
        tabs.delete(tab.id)
        runtimeNotices.delete(tab.id)
        closedTabIds.add(tab.id)
      }
    }
    const activeTabId = new Map(state.activeTabId)
    activeTabId.delete(projectId)
    const sidebarItems = new Map(state.sidebarItems)
    sidebarItems.delete(projectId)
    return { tabs, activeTabId, sidebarItems, runtimeNotices, closedTabIds }
  })

  useTerminalStore.setState((state) => {
    const sessions = new Map(state.sessions)
    const scrollback = new Map(state.scrollback)
    const diagnostics = new Map(state.diagnostics)
    const closedSessionIds = new Set(state.closedSessionIds)
    for (const session of sessions.values()) {
      if (session.projectId === projectId) {
        sessions.delete(session.id)
        scrollback.delete(session.id)
        diagnostics.delete(session.id)
        closedSessionIds.add(session.id)
      }
    }
    const activeSessionId = new Map(state.activeSessionId)
    activeSessionId.delete(projectId)
    return { sessions, activeSessionId, scrollback, diagnostics, closedSessionIds }
  })

  useCodexStore.setState((state) => {
    const threads = new Map(state.threads)
    const messagesByThread = new Map(state.messagesByThread)
    for (const thread of threads.values()) {
      if (thread.projectId === projectId) {
        threads.delete(thread.id)
        messagesByThread.delete(thread.id)
      }
    }
    const activeThreadId = new Map(state.activeThreadId)
    activeThreadId.delete(projectId)
    const sidebarItems = new Map(state.sidebarItems)
    sidebarItems.delete(projectId)
    return {
      threads,
      activeThreadId,
      messagesByThread,
      sidebarItems,
      approvals: state.approvals.filter((approval) => approval.projectId !== projectId),
    }
  })

  useEditorStore.getState().removeProjectDocuments(projectId)
}
