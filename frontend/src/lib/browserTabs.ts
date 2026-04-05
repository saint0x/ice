import type { BrowserTab, ProjectId } from '@/types'
import { browserTabCreate, toBrowserTab } from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
import { useWorkspaceStore } from '@/stores/workspace'

export async function createAndOpenBrowserTab(projectId: ProjectId): Promise<BrowserTab> {
  const created = await browserTabCreate(projectId)
  const mapped = toBrowserTab(created)
  const workspace = useWorkspaceStore.getState()
  const browserStore = useBrowserStore.getState()

  browserStore.upsertTab(mapped)
  browserStore.setActiveTab(projectId, mapped.id)
  workspace.openTab(workspace.activePaneId, 'browser', mapped.title, projectId, {
    tabId: mapped.id,
    url: mapped.url,
  })

  return mapped
}
