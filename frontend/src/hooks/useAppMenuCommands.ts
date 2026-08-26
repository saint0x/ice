import { useEffect } from 'react'
import { useWorkspaceStore } from '@/stores/workspace'

type EditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'

interface ActiveSurfaceCommandDetail {
  tabId: string
  type: string
}

function selectAllInActiveElement(): boolean {
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    activeElement.focus()
    activeElement.select()
    return true
  }
  if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
    const selection = window.getSelection()
    if (!selection) return false
    const range = document.createRange()
    range.selectNodeContents(activeElement)
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }
  return false
}

function runEditCommand(command: EditCommand): void {
  if (command === 'selectAll' && selectAllInActiveElement()) {
    return
  }
  document.execCommand(command)
}

function getActiveTabDetail(): ActiveSurfaceCommandDetail | null {
  const workspace = useWorkspaceStore.getState()
  const pane = findActivePane(workspace.layout, workspace.activePaneId)
  if (!pane?.activeTabId) return null
  const tab = workspace.tabs.get(pane.activeTabId)
  if (!tab) return null
  return { tabId: tab.id, type: tab.type }
}

function findActivePane(
  node: ReturnType<typeof useWorkspaceStore.getState>['layout'],
  activePaneId: string,
): { activeTabId: string | null } | null {
  if (node.type === 'leaf') {
    return node.id === activePaneId ? node : null
  }
  for (const child of node.children) {
    const found = findActivePane(child, activePaneId)
    if (found) return found
  }
  return null
}

export function useAppMenuCommands(): void {
  useEffect(() => {
    const editHandler = (event: Event) => {
      const detail = (event as CustomEvent<EditCommand>).detail
      if (!detail) return
      runEditCommand(detail)
    }

    const docsHandler = () => {
      window.open('https://github.com/saint0x/ice', '_blank', 'noopener,noreferrer')
    }

    const saveHandler = () => {
      const active = getActiveTabDetail()
      if (!active) return
      window.dispatchEvent(new CustomEvent<ActiveSurfaceCommandDetail>('ice:surface:save', { detail: active }))
    }

    const findHandler = () => {
      const active = getActiveTabDetail()
      if (!active) return
      window.dispatchEvent(new CustomEvent<ActiveSurfaceCommandDetail>('ice:surface:find', { detail: active }))
    }

    window.addEventListener('ice:menu:edit-command', editHandler as EventListener)
    window.addEventListener('ice:menu:docs', docsHandler)
    window.addEventListener('ice:menu:save', saveHandler)
    window.addEventListener('ice:menu:find', findHandler)
    return () => {
      window.removeEventListener('ice:menu:edit-command', editHandler as EventListener)
      window.removeEventListener('ice:menu:docs', docsHandler)
      window.removeEventListener('ice:menu:save', saveHandler)
      window.removeEventListener('ice:menu:find', findHandler)
    }
  }, [])
}
