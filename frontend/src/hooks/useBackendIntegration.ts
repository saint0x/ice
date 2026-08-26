import { useEffect, useRef } from 'react'
import {
  appBootstrap,
  browserTabsList,
  codexApprovalsList,
  projectBrowserSidebar,
  projectCodexSidebar,
  codexThreadsList,
  gitStatusRead,
  listenBrowserEvents,
  listenCodexEvents,
  listenFsEvents,
  listenGitEvents,
  listenTerminalEvents,
  projectTreeReadNested,
  projectWatchStart,
  projectWatchStop,
  terminalList,
  toBrowserTab,
  toBrowserRuntimeNotice,
  toCodexApproval,
  toCodexMessage,
  toCodexRuntimeError,
  toProjectBrowserSidebarItem,
  toProjectCodexSidebarItem,
  toCodexThread,
  toFileTree,
  toGitState,
  toGitMutationEvent,
  toProject,
  toTerminalRuntimeError,
  toTerminalSession,
  toWorkspaceChromePersist,
  toWorkspaceInput,
  toWorkspaceSessionPersist,
  workspaceChromeSet,
  workspaceSessionSet,
} from '@/lib/backend'
import { prefetchProjectDocuments as prefetchEditorProjectDocuments } from '@/lib/editorDocuments'
import { logFrontendEvent } from '@/lib/diagnostics'
import { resolveWorkbenchProjectIdFromState } from '@/lib/projectResolution'
import { closeWorkspaceTabsForBrowserTab, closeWorkspaceTabsForTerminalSession, reconcileWorkspaceBackingResources } from '@/lib/workspaceTabs'
import { useFilesStore } from '@/stores/files'
import { useGitStore } from '@/stores/git'
import { useNotificationsStore } from '@/stores/notifications'
import { useProjectsStore } from '@/stores/projects'
import { useCodexStore } from '@/stores/codex'
import { useTerminalStore } from '@/stores/terminal'
import { useBrowserStore } from '@/stores/browser'
import { useWorkspaceStore } from '@/stores/workspace'

const TREE_REFRESH_EVENT_TYPES = new Set([
  'watchEvent',
  'fileWritten',
  'dirCreated',
  'entryDeleted',
  'entryRenamed',
  'externalImported',
  'watchStarted',
])

type BackendEventRegistrar<TPayload> = (handler: (payload: TPayload) => void) => Promise<() => void>

export function registerBackendEventListener<TPayload>(input: {
  label: string
  listen: BackendEventRegistrar<TPayload>
  handler: (payload: TPayload) => void
  setUnlisten: (unlisten: () => void) => void
  isDisposed?: () => boolean
  pushError: (title: string, error: unknown, fallbackMessage?: string) => string
}) {
  void input.listen(input.handler)
    .then((unlisten) => {
      if (input.isDisposed?.()) {
        unlisten()
        return
      }
      input.setUnlisten(unlisten)
    })
    .catch((error: unknown) => {
      if (input.isDisposed?.()) return
      input.pushError(
        `${input.label} listener failed`,
        error,
        `Failed to connect ${input.label.toLowerCase()} updates`,
      )
    })
}

export async function startProjectWatchForActiveProject(input: {
  projectId: string
  watchedProjectRef: { current: string | null }
  projectWatchStart: (projectId: string) => Promise<unknown>
  projectWatchStop: (projectId: string) => Promise<unknown>
  isCancelled: () => boolean
}) {
  if (input.watchedProjectRef.current === input.projectId) return

  await input.projectWatchStart(input.projectId)
  if (input.isCancelled()) {
    await input.projectWatchStop(input.projectId)
    return
  }
  input.watchedProjectRef.current = input.projectId
}

export function useBackendIntegration() {
  const hydrateProjects = useProjectsStore((state) => state.hydrateProjects)
  const activeProjectId = useProjectsStore((state) => state.activeProjectId)
  const projects = useProjectsStore((state) => state.projects)
  const projectOrder = useProjectsStore((state) => state.projectOrder)
  const updateProject = useProjectsStore((state) => state.updateProject)
  const hydrateTree = useFilesStore((state) => state.hydrateTree)
  const hydrateGitState = useGitStore((state) => state.hydrateGitState)
  const recordGitMutation = useGitStore((state) => state.recordMutation)
  const hydrateBrowserTabs = useBrowserStore((state) => state.hydrateTabs)
  const hydrateBrowserSidebarItems = useBrowserStore((state) => state.hydrateSidebarItems)
  const upsertBrowserTab = useBrowserStore((state) => state.upsertTab)
  const closeBrowserTab = useBrowserStore((state) => state.closeTab)
  const pushBrowserRuntimeNotice = useBrowserStore((state) => state.pushRuntimeNotice)
  const hydrateSessions = useTerminalStore((state) => state.hydrateSessions)
  const upsertSession = useTerminalStore((state) => state.upsertSession)
  const appendScrollback = useTerminalStore((state) => state.appendScrollback)
  const clearScrollback = useTerminalStore((state) => state.clearScrollback)
  const closeSession = useTerminalStore((state) => state.closeSession)
  const hydrateThreads = useCodexStore((state) => state.hydrateThreads)
  const hydrateApprovals = useCodexStore((state) => state.hydrateApprovals)
  const hydrateCodexSidebarItems = useCodexStore((state) => state.hydrateSidebarItems)
  const addThread = useCodexStore((state) => state.addThread)
  const updateThread = useCodexStore((state) => state.updateThread)
  const upsertMessage = useCodexStore((state) => state.upsertMessage)
  const addApproval = useCodexStore((state) => state.addApproval)
  const resolveApproval = useCodexStore((state) => state.resolveApproval)
  const hydrateWorkspace = useWorkspaceStore((state) => state.hydrateWorkspace)
  const pushError = useNotificationsStore((state) => state.pushError)

  const sidebarOpen = useWorkspaceStore((state) => state.sidebarOpen)
  const sidebarWidth = useWorkspaceStore((state) => state.sidebarWidth)
  const bottomDockOpen = useWorkspaceStore((state) => state.bottomDockOpen)
  const bottomDockHeight = useWorkspaceStore((state) => state.bottomDockHeight)
  const chatPanelOpen = useWorkspaceStore((state) => state.chatPanelOpen)
  const chatPanelWidth = useWorkspaceStore((state) => state.chatPanelWidth)
  const layout = useWorkspaceStore((state) => state.layout)
  const tabs = useWorkspaceStore((state) => state.tabs)
  const activePaneId = useWorkspaceStore((state) => state.activePaneId)
  const activeProjectContextId = resolveWorkbenchProjectIdFromState({
    activeProjectId,
    projects,
    projectOrder,
    layout,
    activePaneId,
    tabs,
  })

  const hydratedRef = useRef(false)
  const watchedProjectRef = useRef<string | null>(null)
  const codexMessageFrameRef = useRef<number | null>(null)
  const pendingCodexMessagesRef = useRef(new Map<string, ReturnType<typeof toCodexMessage>>())
  const pendingCodexSidebarRefreshRef = useRef(new Set<string>())
  const codexSidebarRefreshTimerRef = useRef<number | null>(null)
  const lastCodexDisconnectRef = useRef<{ message: string; at: number } | null>(null)
  useEffect(() => {
    let disposed = false
    let fsUnlisten: (() => void) | undefined
    let gitUnlisten: (() => void) | undefined
    let browserUnlisten: (() => void) | undefined
    let terminalUnlisten: (() => void) | undefined
    let codexUnlisten: (() => void) | undefined
    const refreshTree = async (projectId: string) => {
      try {
        const nodes = await projectTreeReadNested(projectId)
        if (!disposed) {
          const tree = toFileTree(nodes)
          hydrateTree(projectId, tree)
          prefetchEditorProjectDocuments({
            projectId,
            tree,
            selectedPath: useFilesStore.getState().selectedPath.get(projectId),
            openTabs: Array.from(useWorkspaceStore.getState().tabs.values()),
          })
        }
      } catch (error) {
        if (!disposed) {
          pushError('Project tree refresh failed', error)
        }
      }
    }

    const refreshBrowserSidebar = async (projectId: string) => {
      const items = await projectBrowserSidebar(projectId)
      if (!disposed) {
        hydrateBrowserSidebarItems(projectId, items.map(toProjectBrowserSidebarItem))
      }
    }

    const refreshCodexSidebar = async (projectId: string) => {
      const items = await projectCodexSidebar(projectId)
      if (!disposed) {
        hydrateCodexSidebarItems(projectId, items.map(toProjectCodexSidebarItem))
      }
    }

    const flushCodexMessages = () => {
      codexMessageFrameRef.current = null
      if (disposed) return
      const bufferedMessages = Array.from(pendingCodexMessagesRef.current.values())
      pendingCodexMessagesRef.current.clear()
      for (const message of bufferedMessages) {
        upsertMessage(message)
      }
      if (
        pendingCodexSidebarRefreshRef.current.size > 0
        && codexSidebarRefreshTimerRef.current == null
      ) {
        codexSidebarRefreshTimerRef.current = window.setTimeout(() => {
          codexSidebarRefreshTimerRef.current = null
          const projectIds = Array.from(pendingCodexSidebarRefreshRef.current.values())
          pendingCodexSidebarRefreshRef.current.clear()
          for (const projectId of projectIds) {
            void refreshCodexSidebar(projectId)
          }
        }, 120)
      }
    }

    const scheduleCodexMessage = (message: ReturnType<typeof toCodexMessage>) => {
      pendingCodexMessagesRef.current.set(message.id, message)
      if (message.state === 'complete') {
        pendingCodexSidebarRefreshRef.current.add(message.projectId)
      }
      if (codexMessageFrameRef.current == null) {
        codexMessageFrameRef.current = window.requestAnimationFrame(flushCodexMessages)
      }
    }

    const bootstrap = async () => {
      await logFrontendEvent('info', 'backend.bootstrap', 'appBootstrap begin')
      const data = await appBootstrap()
      if (disposed) return
      await logFrontendEvent('info', 'backend.bootstrap', 'appBootstrap resolved', {
        projectCount: data.projects.length,
      })

      const projects = data.projects.map(toProject)
      hydrateProjects(projects)
      hydrateWorkspace(toWorkspaceInput(data.workspaceChrome, data.workspaceSession))

      const restoredTabs = Array.from(useWorkspaceStore.getState().tabs.values())
        .filter((tab) => tab.type === 'editor' && typeof tab.meta?.path === 'string')
      for (const tab of restoredTabs) {
        prefetchEditorProjectDocuments({
          projectId: tab.projectId,
          tree: [],
          openTabs: [tab],
          eager: true,
        })
      }

      const [browserTabs, terminalSessions, codexThreads, pendingApprovals] = await Promise.all([
        browserTabsList(),
        terminalList(),
        codexThreadsList(),
        codexApprovalsList(),
      ])
      if (disposed) return
      const hydratedBrowserTabs = browserTabs.map(toBrowserTab)
      const hydratedTerminalSessions = terminalSessions.map(toTerminalSession)
      const hydratedCodexThreads = codexThreads.map(toCodexThread)
      hydrateBrowserTabs(hydratedBrowserTabs)
      hydrateSessions(hydratedTerminalSessions)
      hydrateThreads(hydratedCodexThreads)
      reconcileWorkspaceBackingResources({
        browserTabIds: hydratedBrowserTabs.map((tab) => tab.id),
        terminalSessionIds: hydratedTerminalSessions.map((session) => session.id),
        codexThreadIds: hydratedCodexThreads.map((thread) => thread.id),
      })
      hydrateApprovals(pendingApprovals.map(toCodexApproval))
      hydratedRef.current = true
      await logFrontendEvent('info', 'backend.bootstrap', 'workspace hydration complete', {
        projectCount: data.projects.length,
      })
    }

    void bootstrap().catch((error: unknown) => {
      void logFrontendEvent('fatal', 'backend.bootstrap', 'bootstrap failed', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      })
      pushError(
        'Backend bootstrap failed',
        error,
        error instanceof Error ? error.message : 'The app backend did not finish bootstrapping.',
      )
    })

    registerBackendEventListener({
      label: 'Project file',
      listen: listenFsEvents,
      handler: (payload) => {
        if (!TREE_REFRESH_EVENT_TYPES.has(payload.type)) return
        void refreshTree(payload.projectId)
      },
      setUnlisten: (unlisten) => {
        fsUnlisten = unlisten
      },
      isDisposed: () => disposed,
      pushError,
    })

    registerBackendEventListener({
      label: 'Git',
      listen: listenGitEvents,
      handler: (payload) => {
        if (!payload.summary) return
        hydrateGitState(payload.projectId, toGitState(payload.summary))
        updateProject(payload.projectId, { branch: payload.summary.branch ?? 'detached' })
        const mutation = toGitMutationEvent(payload)
        if (mutation) {
          recordGitMutation(mutation)
        }
      },
      setUnlisten: (unlisten) => {
        gitUnlisten = unlisten
      },
      isDisposed: () => disposed,
      pushError,
    })

    registerBackendEventListener({
      label: 'Browser',
      listen: listenBrowserEvents,
      handler: (payload) => {
        const runtimeNotice = toBrowserRuntimeNotice(payload)
        if (runtimeNotice) {
          if (!runtimeNotice.projectId && payload.tab) {
            runtimeNotice.projectId = payload.tab.projectId
          }
          if (!runtimeNotice.projectId && payload.request && 'projectId' in payload.request) {
            runtimeNotice.projectId = payload.request.projectId
          }
          pushBrowserRuntimeNotice(runtimeNotice)
        }
        if (
          (payload.type === 'tabCreated' ||
            payload.type === 'tabNavigated' ||
            payload.type === 'tabPinChanged' ||
            payload.type === 'tabUpdated' ||
            payload.type === 'tabLoadStateChanged' ||
            payload.type === 'tabRendererStateChanged' ||
            payload.type === 'tabHistoryChanged' ||
            payload.type === 'tabReloaded') &&
          payload.tab
        ) {
          upsertBrowserTab(toBrowserTab(payload.tab))
          void refreshBrowserSidebar(payload.tab.projectId)
          return
        }
        if (payload.type === 'tabClosed' && payload.tabId) {
          closeBrowserTab(payload.tabId)
          closeWorkspaceTabsForBrowserTab(payload.tabId)
        }
      },
      setUnlisten: (unlisten) => {
        browserUnlisten = unlisten
      },
      isDisposed: () => disposed,
      pushError,
    })

    registerBackendEventListener({
      label: 'Terminal',
      listen: listenTerminalEvents,
      handler: (payload) => {
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
        const terminalRuntimeError = toTerminalRuntimeError(payload)
        if (terminalRuntimeError) {
          pushError(terminalRuntimeError.title, terminalRuntimeError.message)
          return
        }
        if (payload.type === 'scrollbackCleared' && payload.sessionId) {
          clearScrollback(payload.sessionId)
          if (payload.session) {
            upsertSession(toTerminalSession(payload.session))
          }
          return
        }
        if (payload.type === 'sessionClosed' && payload.sessionId) {
          closeSession(payload.sessionId)
          closeWorkspaceTabsForTerminalSession(payload.sessionId)
        }
      },
      setUnlisten: (unlisten) => {
        terminalUnlisten = unlisten
      },
      isDisposed: () => disposed,
      pushError,
    })

    registerBackendEventListener({
      label: 'Codex',
      listen: listenCodexEvents,
      handler: (payload) => {
        const codexRuntimeError = toCodexRuntimeError(payload)
        if (codexRuntimeError) {
          pushError(codexRuntimeError.title, codexRuntimeError.message)
          return
        }
        if ((payload.type === 'threadCreated' || payload.type === 'threadUpdated') && payload.thread) {
          const thread = toCodexThread(payload.thread)
          if (payload.type === 'threadCreated') {
            addThread(thread)
            void refreshCodexSidebar(thread.projectId)
          } else {
            updateThread(thread.id, thread)
          }
          return
        }
        if (payload.type === 'messageUpserted' && payload.message) {
          const message = toCodexMessage(payload.message)
          scheduleCodexMessage(message)
          if (message.role === 'assistant' && message.state === 'complete') {
            updateThread(message.threadId, { status: 'idle' })
          }
          return
        }
        if (payload.type === 'approvalPending' && payload.approval) {
          addApproval(toCodexApproval(payload.approval))
          void refreshCodexSidebar(payload.approval.projectId)
          return
        }
        if (payload.type === 'approvalBlocked' && payload.approval) {
          resolveApproval(String(payload.approval.requestId))
          void refreshCodexSidebar(payload.approval.projectId)
          return
        }
        if (payload.type === 'serverDisconnected') {
          const reason = typeof payload.reason === 'string' && payload.reason.trim()
            ? payload.reason.trim()
            : 'The Codex app server disconnected.'
          const recentLines = Array.isArray(payload.recentLines)
            ? payload.recentLines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
            : []
          const detail = recentLines.length > 0
            ? `${reason} Recent runtime output: ${recentLines.join(' | ')}`
            : `${reason} Retry the request to reconnect, or open Settings to inspect Codex runtime health.`
          const lastDisconnect = lastCodexDisconnectRef.current
          const now = Date.now()
          if (!lastDisconnect || lastDisconnect.message !== detail || now - lastDisconnect.at > 4000) {
            lastCodexDisconnectRef.current = { message: detail, at: now }
            pushError('Codex disconnected', detail)
          }
          return
        }
        if (payload.type === 'notification' && payload.payload?.method === 'error') {
          const error = payload.payload.params?.error as { message?: string } | undefined
          const threadId = payload.payload.params?.threadId as string | undefined
          if (threadId) {
            updateThread(threadId, { status: 'error' })
          }
          pushError(
            'Codex turn failed',
            error,
            typeof error?.message === 'string'
              ? error.message
              : 'The Codex turn failed before producing a response.',
          )
          return
        }
        if (payload.type === 'notification' && payload.payload?.method) {
          const threadId = extractCodexThreadId(payload.payload.params)
          if (!threadId) return
          const status = inferCodexStatusFromNotification(payload.payload.method, payload.payload.params)
          if (status) {
            updateThread(threadId, { status })
          }
        }
      },
      setUnlisten: (unlisten) => {
        codexUnlisten = unlisten
      },
      isDisposed: () => disposed,
      pushError,
    })

    return () => {
      disposed = true
      fsUnlisten?.()
      gitUnlisten?.()
      browserUnlisten?.()
      terminalUnlisten?.()
      codexUnlisten?.()
      if (codexMessageFrameRef.current != null) {
        window.cancelAnimationFrame(codexMessageFrameRef.current)
      }
      if (codexSidebarRefreshTimerRef.current != null) {
        window.clearTimeout(codexSidebarRefreshTimerRef.current)
      }
      if (watchedProjectRef.current) {
        void projectWatchStop(watchedProjectRef.current)
      }
    }
  }, [addApproval, addThread, appendScrollback, clearScrollback, closeBrowserTab, closeSession, hydrateApprovals, hydrateBrowserSidebarItems, hydrateBrowserTabs, hydrateCodexSidebarItems, hydrateGitState, hydrateProjects, hydrateSessions, hydrateThreads, hydrateTree, hydrateWorkspace, pushBrowserRuntimeNotice, pushError, recordGitMutation, resolveApproval, updateProject, updateThread, upsertBrowserTab, upsertMessage, upsertSession])

  useEffect(() => {
    if (!hydratedRef.current) return
    let cancelled = false

    const stopCurrentWatch = async () => {
      const watchedProjectId = watchedProjectRef.current
      if (!watchedProjectId) return
      try {
        await projectWatchStop(watchedProjectId)
      } catch (error) {
        if (!cancelled) {
          pushError('Project watch stop failed', error)
        }
      } finally {
        if (watchedProjectRef.current === watchedProjectId) {
          watchedProjectRef.current = null
        }
      }
    }

    if (!activeProjectContextId) {
      void stopCurrentWatch()
      return () => {
        cancelled = true
      }
    }

    const activateProject = async () => {
      try {
        if (watchedProjectRef.current && watchedProjectRef.current !== activeProjectContextId) {
          await stopCurrentWatch()
        }
        const [tree, git, browserSidebarItems, codexSidebarItems] = await Promise.all([
          projectTreeReadNested(activeProjectContextId),
          gitStatusRead(activeProjectContextId),
          projectBrowserSidebar(activeProjectContextId),
          projectCodexSidebar(activeProjectContextId),
        ])
        if (cancelled) return
        const mappedTree = toFileTree(tree)
        hydrateTree(activeProjectContextId, mappedTree)
        hydrateGitState(activeProjectContextId, toGitState(git))
        hydrateBrowserSidebarItems(activeProjectContextId, browserSidebarItems.map(toProjectBrowserSidebarItem))
        hydrateCodexSidebarItems(activeProjectContextId, codexSidebarItems.map(toProjectCodexSidebarItem))
        updateProject(activeProjectContextId, { branch: git.branch ?? 'detached' })
        prefetchEditorProjectDocuments({
          projectId: activeProjectContextId,
          tree: mappedTree,
          selectedPath: useFilesStore.getState().selectedPath.get(activeProjectContextId),
          openTabs: Array.from(useWorkspaceStore.getState().tabs.values()),
          eager: true,
        })
        await startProjectWatchForActiveProject({
          projectId: activeProjectContextId,
          watchedProjectRef,
          projectWatchStart,
          projectWatchStop,
          isCancelled: () => cancelled,
        })
      } catch (error) {
        if (!cancelled) {
          pushError('Active project load failed', error)
        }
      }
    }

    void activateProject()
    return () => {
      cancelled = true
    }
  }, [activeProjectContextId, hydrateBrowserSidebarItems, hydrateCodexSidebarItems, hydrateGitState, hydrateTree, pushError, updateProject])

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
    ).catch((error: unknown) => {
      pushError('Workspace chrome save failed', error, 'Failed to persist workspace chrome state')
    })
  }, [
    sidebarOpen,
    sidebarWidth,
    bottomDockOpen,
    bottomDockHeight,
    chatPanelOpen,
    chatPanelWidth,
    pushError,
  ])

  useEffect(() => {
    if (!hydratedRef.current) return
    void workspaceSessionSet(
      toWorkspaceSessionPersist({
        activePaneId,
        layout,
        tabs,
      }),
    ).catch((error: unknown) => {
      pushError('Workspace session save failed', error, 'Failed to persist workspace session state')
    })
  }, [activePaneId, layout, pushError, tabs])
}

function extractCodexThreadId(params?: Record<string, unknown>) {
  if (!params) return null
  if (typeof params.threadId === 'string' && params.threadId.length > 0) {
    return params.threadId
  }
  const thread = params.thread
  if (thread && typeof thread === 'object' && typeof (thread as { id?: unknown }).id === 'string') {
    return (thread as { id: string }).id
  }
  return null
}

function inferCodexStatusFromNotification(
  method: string,
  params?: Record<string, unknown>,
): 'idle' | 'running' | 'waitingApproval' | 'error' | null {
  if (method === 'turn/completed') {
    return 'idle'
  }
  if (method === 'turn/started') {
    return 'running'
  }
  if (method === 'error') {
    return 'error'
  }
  if (method.includes('approval')) {
    return 'waitingApproval'
  }
  if (method !== 'thread/status/changed' || !params) {
    return null
  }

  const status = params.status
  if (!status || typeof status !== 'object') {
    return null
  }
  const type = (status as { type?: unknown }).type
  if (type === 'active') {
    const flags = (status as { activeFlags?: unknown }).activeFlags
    if (Array.isArray(flags) && flags.some((flag) => typeof flag === 'string' && flag.toLowerCase().includes('approval'))) {
      return 'waitingApproval'
    }
    return 'running'
  }
  if (type === 'idle' || type === 'notLoaded') {
    return 'idle'
  }
  if (type === 'systemError') {
    return 'error'
  }
  return null
}
