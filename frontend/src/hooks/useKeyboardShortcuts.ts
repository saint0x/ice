import { useEffect } from 'react'
import { useWorkspaceStore } from '@/stores/workspace'

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const state = useWorkspaceStore.getState()

      if (meta && e.key === 'b') {
        e.preventDefault()
        state.setSidebarOpen(!state.sidebarOpen)
      } else if (meta && e.key === 'j') {
        e.preventDefault()
        state.setBottomDockOpen(!state.bottomDockOpen)
      } else if (meta && e.key === 'l') {
        e.preventDefault()
        state.setChatPanelOpen(!state.chatPanelOpen)
      } else if (meta && e.key === 'w') {
        e.preventDefault()
        if (state.layout.type === 'leaf' && state.layout.activeTabId) {
          state.closeTab(state.layout.id, state.layout.activeTabId)
        }
      } else if (meta && !e.shiftKey && e.key === '\\') {
        e.preventDefault()
        state.splitPane(state.activePaneId, 'horizontal')
      } else if (meta && e.shiftKey && e.key === '|') {
        e.preventDefault()
        state.splitPane(state.activePaneId, 'vertical')
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
