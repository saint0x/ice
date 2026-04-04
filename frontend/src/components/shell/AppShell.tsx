import { memo } from 'react'
import { TitleBar } from './TitleBar'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { PaneGrid } from '@/components/panes/PaneGrid'
import { BottomDock } from './BottomDock'
import { ChatPanel } from './ChatPanel'
import { useWorkspaceStore } from '@/stores/workspace'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import styles from './AppShell.module.css'

export const AppShell = memo(function AppShell() {
  useKeyboardShortcuts()

  const bottomDockOpen = useWorkspaceStore((s) => s.bottomDockOpen)
  const chatPanelOpen = useWorkspaceStore((s) => s.chatPanelOpen)

  return (
    <div className={styles.shell}>
      <TitleBar />
      <div className={styles.body}>
        <Sidebar />
        <div className={styles.main}>
          <PaneGrid />
          {bottomDockOpen && <BottomDock />}
        </div>
        {chatPanelOpen && <ChatPanel />}
      </div>
    </div>
  )
})
