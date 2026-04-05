import { memo, useMemo } from 'react'
import { Globe, Plus, X, Lock, Circle, Pin } from 'lucide-react'
import type { ProjectId } from '@/types'
import { browserTabClose, browserTabCreate, browserTabPinSet, toBrowserTab } from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
import { useWorkspaceStore } from '@/stores/workspace'
import styles from './BrowserList.module.css'

export const BrowserList = memo(function BrowserList({ projectId }: { projectId: ProjectId }) {
  const allTabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId.get(projectId))
  const setActiveTab = useBrowserStore((s) => s.setActiveTab)
  const upsertTab = useBrowserStore((s) => s.upsertTab)
  const closeTab = useBrowserStore((s) => s.closeTab)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)

  const tabs = useMemo(() => {
    const result = []
    for (const tab of allTabs.values()) {
      if (tab.projectId === projectId) result.push(tab)
    }
    return result
  }, [allTabs, projectId])

  return (
    <div className={styles.list}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`${styles.row} ${tab.id === activeTabId ? styles.active : ''}`}
          onClick={() => {
            setActiveTab(projectId, tab.id)
            openTab(activePaneId, 'browser', tab.title, projectId, { tabId: tab.id, url: tab.url })
          }}
        >
          {tab.isSecure ? <Lock size={12} /> : <Globe size={12} />}
          <span className={styles.title}>{tab.title}</span>
          {tab.isPinned && <Pin size={10} className={styles.pinIcon} />}
          {tab.isLoading && <Circle size={6} className={styles.loading} />}
          <button
            className={styles.iconBtn}
            onClick={(event) => {
              event.stopPropagation()
              void browserTabPinSet(tab.id, !tab.isPinned).then((next) => {
                upsertTab(toBrowserTab(next))
              })
            }}
            aria-label={tab.isPinned ? 'Unpin browser tab' : 'Pin browser tab'}
          >
            <Pin size={10} />
          </button>
          <button
            className={styles.iconBtn}
            onClick={(event) => {
              event.stopPropagation()
              closeTab(tab.id)
              void browserTabClose(tab.id)
            }}
            aria-label="Close browser tab"
          >
            <X size={10} />
          </button>
        </div>
      ))}
      <button
        className={styles.addBtn}
        onClick={() => {
          void browserTabCreate(projectId, 'https://example.com').then((tab) => {
            const mapped = toBrowserTab(tab)
            upsertTab(mapped)
            setActiveTab(projectId, mapped.id)
            openTab(activePaneId, 'browser', mapped.title, projectId, { tabId: mapped.id, url: mapped.url })
          })
        }}
      >
        <Plus size={12} />
        <span>New Tab</span>
      </button>
    </div>
  )
})
