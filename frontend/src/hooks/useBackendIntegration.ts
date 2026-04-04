import { useEffect, useRef } from 'react'
import {
  appBootstrap,
  gitStatusRead,
  listenFsEvents,
  listenGitEvents,
  projectTreeReadNested,
  projectWatchStart,
  projectWatchStop,
  toFileTree,
  toGitState,
  toProject,
  toWorkspaceChromePersist,
  toWorkspaceInput,
  toWorkspaceSessionPersist,
  workspaceChromeSet,
  workspaceSessionSet,
} from '@/lib/backend'
import { useFilesStore } from '@/stores/files'
import { useGitStore } from '@/stores/git'
import { useProjectsStore } from '@/stores/projects'
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

    return () => {
      disposed = true
      fsUnlisten?.()
      gitUnlisten?.()
      for (const projectId of watchedProjects) {
        void projectWatchStop(projectId)
      }
    }
  }, [hydrateGitState, hydrateProjects, hydrateTree, hydrateWorkspace, updateProject])

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
