import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { X, SplitSquareHorizontal } from 'lucide-react'
import type { PaneNode } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace'
import { ContentRenderer } from './ContentRenderer'
import styles from './Pane.module.css'

interface Props {
  pane: PaneNode
}

export const Pane = memo(function Pane({ pane }: Props) {
  const allTabs = useWorkspaceStore((s) => s.tabs)
  const tabs = useMemo(() => {
    const result = []
    for (const tabId of pane.tabs) {
      const tab = allTabs.get(tabId)
      if (tab) result.push(tab)
    }
    return result
  }, [allTabs, pane.tabs])
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const pendingFocusPaneId = useWorkspaceStore((s) => s.pendingFocusPaneId)
  const activateTab = useWorkspaceStore((s) => s.activateTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const setActivePane = useWorkspaceStore((s) => s.setActivePane)
  const clearPendingFocusPane = useWorkspaceStore((s) => s.clearPendingFocusPane)
  const splitPane = useWorkspaceStore((s) => s.splitPane)
  const paneRef = useRef<HTMLDivElement>(null)

  const isActive = pane.id === activePaneId
  const activeTab = pane.activeTabId ? tabs.find((t) => t.id === pane.activeTabId) : null

  const onPaneClick = useCallback(() => {
    setActivePane(pane.id)
  }, [pane.id, setActivePane])

  useEffect(() => {
    if (pendingFocusPaneId !== pane.id) return
    paneRef.current?.focus()
    clearPendingFocusPane(pane.id)
  }, [clearPendingFocusPane, pane.id, pendingFocusPaneId])

  return (
    <div
      ref={paneRef}
      className={`${styles.pane} ${isActive ? styles.active : ''}`}
      tabIndex={0}
      onClick={onPaneClick}
      onFocusCapture={onPaneClick}
    >
      {tabs.length > 0 && (
        <div className={`${styles.tabBar} ${isActive ? styles.activeTabBar : ''}`}>
          <div className={styles.tabs}>
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`${styles.tab} ${tab.id === pane.activeTabId ? styles.activeTab : ''}`}
                onClick={() => activateTab(pane.id, tab.id)}
              >
                <span className={styles.tabTitle}>{tab.title}</span>
                {tab.dirty && <span className={styles.dirty} />}
                <button
                  className={styles.tabClose}
                  onClick={(e) => { e.stopPropagation(); closeTab(pane.id, tab.id) }}
                  aria-label="Close tab"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
          <button
            className={styles.splitBtn}
            onClick={() => splitPane(pane.id, 'horizontal')}
            aria-label="Split pane"
          >
            <SplitSquareHorizontal size={13} />
          </button>
        </div>
      )}
      <div className={styles.content}>
        {activeTab ? (
          <ContentRenderer tab={activeTab} />
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyText}>No open tabs</span>
            <span className={styles.emptyHint}>Open a file from the sidebar</span>
          </div>
        )}
      </div>
    </div>
  )
})
