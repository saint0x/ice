import { useEffect, useRef } from 'react'
import {
  appBootstrap,
  codexApprovalsList,
  codexThreadsList,
  gitStatusRead,
  listenCodexEvents,
  listenFsEvents,
  listenGitEvents,
  listenTerminalEvents,
  projectTreeReadNested,
  projectWatchStart,
  projectWatchStop,
  terminalList,
  terminalScrollbackRead,
  toCodexApproval,
  toCodexThread,
  toFileTree,
  toGitState,
  toProject,
  toTerminalSession,
  toWorkspaceChromePersist,
  toWorkspaceInput,
  toWorkspaceSessionPersist,
  workspaceChromeSet,
  workspaceSessionSet,
} from '@/lib/backend'
import { useFilesStore } from '@/stores/files'
import { useGitStore } from '@/stores/git'
import { useProjectsStore } from '@/stores/projects'
import { useCodexStore } from '@/stores/codex'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'

const TREE_REFRESH_EVENT_TYPES = new Set([
  'watchEvent',
  'fileWritten',
  'dirCreated',
  'entryDeleted',
  'entryRenamed',
  'watchStarted',
])

export function useBackendIntegration() {
  const hydrateProjects = useProjectsStore((state) => state.hydrateProjects)
  const updateProject = useProjectsStore((state) => state.updateProject)
  const hydrateTree = useFilesStore((state) => state.hydrateTree)
  const hydrateGitState = useGitStore((state) => state.hydrateGitState)
  const hydrateSessions = useTerminalStore((state) => state.hydrateSessions)
  const upsertSession = useTerminalStore((state) => state.upsertSession)
  const setScrollback = useTerminalStore((state) => state.setScrollback)
  const appendScrollback = useTerminalStore((state) => state.appendScrollback)
  const closeSession = useTerminalStore((state) => state.closeSession)
  const hydrateThreads = useCodexStore((state) => state.hydrateThreads)
  const hydrateApprovals = useCodexStore((state) => state.hydrateApprovals)
  const addThread = useCodexStore((state) => state.addThread)
  const updateThread = useCodexStore((state) => state.updateThread)
  const addApproval = useCodexStore((state) => state.addApproval)
  const resolveApproval = useCodexStore((state) => state.resolveApproval)
  const hydrateWorkspace = useWorkspaceStore((state) => state.hydrateWorkspace)

  const sidebarOpen = useWorkspaceStore((state) => state.sidebarOpen)
  const sidebarWidth = useWorkspaceStore((state) => state.sidebarWidth)
  const bottomDockOpen = useWorkspaceStore((state) => state.bottomDockOpen)
  const bottomDockHeight = useWorkspaceStore((state) => state.bottomDockHeight)
  const chatPanelOpen = useWorkspaceStore((state) => state.chatPanelOpen)
  const chatPanelWidth = useWorkspaceStore((state) => state.chatPanelWidth)
  const layout = useWorkspaceStore((state) => state.layout)
  const tabs = useWorkspaceStore((state) => state.tabs)
  const activePaneId = useWorkspaceStore((state) => state.activePaneId)

  const hydratedRef = useRef(false)
  useEffect(() => {
    let disposed = false
    let fsUnlisten: (() => void) | undefined
    let gitUnlisten: (() => void) | undefined
    let terminalUnlisten: (() => void) | undefined
    let codexUnlisten: (() => void) | undefined
    const watchedProjects = new Set<string>()

    const refreshTree = async (projectId: string) => {
      const nodes = await projectTreeReadNested(projectId)
      if (!disposed) {
        hydrateTree(projectId, toFileTree(nodes))
      }
    }

    const bootstrap = async () => {
      const data = await appBootstrap()
      if (disposed) return

      const projects = data.projects.map(toProject)
      hydrateProjects(projects)
      hydrateWorkspace(toWorkspaceInput(data.workspaceChrome, data.workspaceSession))

      const [sessions, threads, approvals] = await Promise.all([
        terminalList(),
        codexThreadsList(),
        codexApprovalsList(),
      ])
      if (disposed) return
      hydrateSessions(sessions.map(toTerminalSession))
      hydrateThreads(threads.map(toCodexThread))
      hydrateApprovals(approvals.map(toCodexApproval))
      await Promise.all(
        sessions.map(async (session) => {
          const scrollback = await terminalScrollbackRead(session.sessionId)
          if (!disposed) {
            setScrollback(session.sessionId, scrollback.content)
          }
        }),
      )

      await Promise.all(
        data.projects.map(async (project) => {
          const [tree, git] = await Promise.all([
            projectTreeReadNested(project.id),
            gitStatusRead(project.id),
            projectWatchStart(project.id),
          ])
          if (disposed) return
          watchedProjects.add(project.id)
          hydrateTree(project.id, toFileTree(tree))
          hydrateGitState(project.id, toGitState(git))
          updateProject(project.id, { branch: git.branch ?? 'detached' })
        }),
      )

      hydratedRef.current = true
    }

    void bootstrap()

    void listenFsEvents((payload) => {
      if (!TREE_REFRESH_EVENT_TYPES.has(payload.type)) return
      void refreshTree(payload.projectId)
    }).then((unlisten) => {
      fsUnlisten = unlisten
    })

    void listenGitEvents((payload) => {
      if (!payload.summary) return
      hydrateGitState(payload.projectId, toGitState(payload.summary))
      updateProject(payload.projectId, { branch: payload.summary.branch ?? 'detached' })
    }).then((unlisten) => {
      gitUnlisten = unlisten
    })

    void listenTerminalEvents((payload) => {
      if (
        (payload.type === 'sessionCreated' ||
          payload.type === 'sessionRenamed' ||
          payload.type === 'sessionExited' ||
          payload.type === 'sessionReadError') &&
        payload.session
      ) {
        upsertSession(toTerminalSession(payload.session))
        return
      }
      if (payload.type === 'data' && payload.sessionId && payload.data) {
        appendScrollback(payload.sessionId, payload.data)
        return
      }
      if (payload.type === 'sessionClosed' && payload.sessionId) {
        closeSession(payload.sessionId)
      }
    }).then((unlisten) => {
      terminalUnlisten = unlisten
    })

    void listenCodexEvents((payload) => {
      if ((payload.type === 'threadCreated' || payload.type === 'threadUpdated') && payload.thread) {
        const thread = toCodexThread(payload.thread)
        if (payload.type === 'threadCreated') {
          addThread(thread)
        } else {
          updateThread(thread.id, thread)
        }
        return
      }
      if (payload.type === 'approvalPending' && payload.approval) {
        addApproval(toCodexApproval(payload.approval))
        return
      }
      if (payload.type === 'approvalBlocked' && payload.approval) {
        resolveApproval(String(payload.approval.requestId))
      }
    }).then((unlisten) => {
      codexUnlisten = unlisten
    })

    return () => {
      disposed = true
      fsUnlisten?.()
      gitUnlisten?.()
      terminalUnlisten?.()
      codexUnlisten?.()
      for (const projectId of watchedProjects) {
        void projectWatchStop(projectId)
      }
    }
  }, [addApproval, addThread, appendScrollback, closeSession, hydrateApprovals, hydrateGitState, hydrateProjects, hydrateSessions, hydrateThreads, hydrateTree, hydrateWorkspace, resolveApproval, setScrollback, updateProject, updateThread, upsertSession])

  useEffect(() => {
    if (!hydratedRef.current) return
    void workspaceChromeSet(
      toWorkspaceChromePersist({
        sidebarOpen,
        sidebarWidth,
        bottomDockOpen,
        bottomDockHeight,
        chatPanelOpen,
        chatPanelWidth,
      }),
    )
  }, [
    sidebarOpen,
    sidebarWidth,
    bottomDockOpen,
    bottomDockHeight,
    chatPanelOpen,
    chatPanelWidth,
  ])

  useEffect(() => {
    if (!hydratedRef.current) return
    void workspaceSessionSet(
      toWorkspaceSessionPersist({
        activePaneId,
        layout,
        tabs,
      }),
    )
  }, [activePaneId, layout, tabs])
}
