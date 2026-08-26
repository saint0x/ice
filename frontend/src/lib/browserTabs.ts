import type { BrowserTab, ProjectId } from '@/types'
import { browserTabCreate, toBrowserTab } from '@/lib/backend'
import { resolveWorkbenchProjectId } from '@/lib/projectResolution'
import { useBrowserStore } from '@/stores/browser'
import { useWorkspaceStore } from '@/stores/workspace'

export async function createAndOpenBrowserTab(projectId?: ProjectId | null): Promise<BrowserTab> {
  const resolvedProjectId = resolveWorkbenchProjectId(projectId)
  if (!resolvedProjectId) {
    throw new Error('Unable to determine which project this browser tab should use.')
  }

  const created = await browserTabCreate(resolvedProjectId)
  const mapped = toBrowserTab(created)
  const workspace = useWorkspaceStore.getState()
  const browserStore = useBrowserStore.getState()

  browserStore.upsertTab(mapped)
  browserStore.setActiveTab(resolvedProjectId, mapped.id)
  workspace.openTab(workspace.activePaneId, 'browser', mapped.title, resolvedProjectId, {
    tabId: mapped.id,
    url: mapped.url,
  })

  return mapped
}
