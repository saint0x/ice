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

  useFilesStore.getState().removeProjectFiles(projectId)

  useGitStore.getState().removeProjectGitState(projectId)

  useBrowserStore.getState().removeProjectTabs(projectId)

  useTerminalStore.getState().removeProjectSessions(projectId)

  useCodexStore.getState().removeProjectThreads(projectId)

  useEditorStore.getState().removeProjectDocuments(projectId)
}
