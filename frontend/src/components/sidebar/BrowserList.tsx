import { memo, useEffect, useState } from 'react'
import { Globe, Plus, X, Lock, Circle, Pin } from 'lucide-react'
import type { ProjectId } from '@/types'
import {
  browserTabPinSet,
  projectBrowserRestorePolicyGet,
  projectBrowserRestorePolicySet,
  toBrowserTab,
  type BrowserRestorePolicy,
} from '@/lib/backend'
import { createAndOpenBrowserTab } from '@/lib/browserTabs'
import { closeBrowserTabEverywhere } from '@/lib/workspaceTabs'
import { useBrowserStore } from '@/stores/browser'
import { useNotificationsStore } from '@/stores/notifications'
import { useWorkspaceStore } from '@/stores/workspace'
import styles from './BrowserList.module.css'

const EMPTY_SIDEBAR_ITEMS = [] as const

export const BrowserList = memo(function BrowserList({ projectId }: { projectId: ProjectId }) {
  const storedSidebarItems = useBrowserStore((s) => s.sidebarItems.get(projectId))
  const activeTabId = useBrowserStore((s) => s.activeTabId.get(projectId))
  const setActiveTab = useBrowserStore((s) => s.setActiveTab)
  const upsertTab = useBrowserStore((s) => s.upsertTab)
  const pushError = useNotificationsStore((s) => s.pushError)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const [restorePolicy, setRestorePolicy] = useState<BrowserRestorePolicy | null>(null)
  const sidebarItems = storedSidebarItems ?? EMPTY_SIDEBAR_ITEMS

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
          pushError('Browser restore policy load failed', 'Failed to load browser restore policy')
        }
      })

    return () => {
      disposed = true
    }
  }, [projectId, pushError])

  return (
    <div className={styles.list}>
      <div className={styles.policyRow}>
        <span className={styles.policyLabel}>Restore</span>
        <select
          className={styles.policySelect}
          value={restorePolicy ?? 'pinned'}
          onChange={(event) => {
            const nextPolicy = event.target.value as BrowserRestorePolicy
            const previousPolicy = restorePolicy
            setRestorePolicy(nextPolicy)
            void projectBrowserRestorePolicySet(projectId, nextPolicy).catch((error: unknown) => {
              pushError('Browser restore policy save failed', error, 'Failed to save browser restore policy')
              void projectBrowserRestorePolicyGet(projectId)
                .then(setRestorePolicy)
                .catch(() => {
                  setRestorePolicy(previousPolicy ?? 'pinned')
                })
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
              void browserTabPinSet(tab.tabId, !tab.isPinned)
                .then((next) => {
                  upsertTab(toBrowserTab(next))
                })
                .catch((error: unknown) => {
                  pushError('Browser pin failed', error, 'Failed to update browser tab pin')
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
              void closeBrowserTabEverywhere(tab.tabId)
                .catch((error: unknown) => {
                  pushError('Browser tab close failed', error, 'Failed to close browser tab')
                })
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
          void createAndOpenBrowserTab(projectId)
            .catch((error: unknown) => {
              pushError('Browser tab failed', error, 'Failed to create browser tab')
            })
        }}
      >
        <Plus size={12} />
        <span>New Tab</span>
      </button>
    </div>
  )
})
