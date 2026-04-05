import { memo, useEffect, useState } from 'react'
import { Globe, Plus, X, Lock, Circle, Pin } from 'lucide-react'
import type { ProjectId } from '@/types'
import {
  browserTabClose,
  browserTabCreate,
  browserTabPinSet,
  projectBrowserRestorePolicyGet,
  projectBrowserRestorePolicySet,
  toBrowserTab,
  type BrowserRestorePolicy,
} from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
import { useWorkspaceStore } from '@/stores/workspace'
import styles from './BrowserList.module.css'

export const BrowserList = memo(function BrowserList({ projectId }: { projectId: ProjectId }) {
  const sidebarItems = useBrowserStore((s) => s.sidebarItems.get(projectId) ?? [])
  const activeTabId = useBrowserStore((s) => s.activeTabId.get(projectId))
  const setActiveTab = useBrowserStore((s) => s.setActiveTab)
  const upsertTab = useBrowserStore((s) => s.upsertTab)
  const closeTab = useBrowserStore((s) => s.closeTab)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const [restorePolicy, setRestorePolicy] = useState<BrowserRestorePolicy | null>(null)

  useEffect(() => {
    let disposed = false
    void projectBrowserRestorePolicyGet(projectId)
      .then((policy) => {
        if (!disposed) {
          setRestorePolicy(policy)
        }
      })
      .catch(() => {
        if (!disposed) {
          setRestorePolicy('pinned')
        }
      })

    return () => {
      disposed = true
    }
  }, [projectId])

  return (
    <div className={styles.list}>
      <div className={styles.policyRow}>
        <span className={styles.policyLabel}>Restore</span>
        <select
          className={styles.policySelect}
          value={restorePolicy ?? 'pinned'}
          onChange={(event) => {
            const nextPolicy = event.target.value as BrowserRestorePolicy
            setRestorePolicy(nextPolicy)
            void projectBrowserRestorePolicySet(projectId, nextPolicy).catch(() => {
              void projectBrowserRestorePolicyGet(projectId).then(setRestorePolicy).catch(() => {})
            })
          }}
          disabled={restorePolicy === null}
        >
          <option value="none">None</option>
          <option value="pinned">Pinned</option>
          <option value="all">All tabs</option>
        </select>
      </div>
      {sidebarItems.map((tab) => (
        <div
          key={tab.tabId}
          className={`${styles.row} ${tab.tabId === activeTabId ? styles.active : ''}`}
          onClick={() => {
            setActiveTab(projectId, tab.tabId)
            openTab(activePaneId, 'browser', tab.title, projectId, { tabId: tab.tabId, url: tab.url })
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
              void browserTabPinSet(tab.tabId, !tab.isPinned).then((next) => {
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
              closeTab(tab.tabId)
              void browserTabClose(tab.tabId)
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
