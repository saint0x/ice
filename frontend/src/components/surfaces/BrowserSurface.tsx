import { memo, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Lock, Globe } from 'lucide-react'
import type { Tab } from '@/types'
import { browserTabBack, browserTabForward, browserTabNavigate, browserTabReload, toBrowserTab } from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
import styles from './BrowserSurface.module.css'

interface Props {
  tab: Tab
}

export const BrowserSurface = memo(function BrowserSurface({ tab }: Props) {
  const browserTabId = tab.meta?.tabId as string | undefined
  const browserTab = useBrowserStore((s) => browserTabId ? s.tabs.get(browserTabId) : undefined)
  const upsertBrowserTab = useBrowserStore((s) => s.upsertTab)
  const [draftUrl, setDraftUrl] = useState<string | null>(null)

  const secure = browserTab?.isSecure ?? false
  const url = draftUrl ?? browserTab?.url ?? (tab.meta?.url as string) ?? 'https://example.com'

  return (
    <div className={styles.surface}>
      <div className={styles.toolbar}>
        <div className={styles.navButtons}>
          <button
            className={styles.navBtn}
            aria-label="Back"
            disabled={!browserTab?.canGoBack}
            onClick={() => {
              if (!browserTabId) return
              void browserTabBack(browserTabId).then((next) => upsertBrowserTab(toBrowserTab(next)))
            }}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            className={styles.navBtn}
            aria-label="Forward"
            disabled={!browserTab?.canGoForward}
            onClick={() => {
              if (!browserTabId) return
              void browserTabForward(browserTabId).then((next) => upsertBrowserTab(toBrowserTab(next)))
            }}
          >
            <ArrowRight size={14} />
          </button>
          <button
            className={styles.navBtn}
            aria-label="Reload"
            onClick={() => {
              if (!browserTabId) return
              void browserTabReload(browserTabId).then((next) => upsertBrowserTab(toBrowserTab(next)))
            }}
          >
            <RotateCw size={13} />
          </button>
        </div>
        <div className={styles.addressBar}>
          {secure ? <Lock size={11} className={styles.lockIcon} /> : <Globe size={11} className={styles.lockIcon} />}
          <input
            className={styles.addressInput}
            value={url}
            onChange={(e) => setDraftUrl(e.target.value)}
            spellCheck={false}
            onBlur={() => setDraftUrl(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && browserTabId) {
                void browserTabNavigate(browserTabId, url).then((next) => {
                  setDraftUrl(null)
                  upsertBrowserTab(toBrowserTab(next))
                })
              }
            }}
          />
        </div>
      </div>
      <div className={styles.viewport}>
        <div className={styles.placeholder}>
          <Globe size={32} className={styles.placeholderIcon} />
          <span className={styles.placeholderUrl}>{browserTab?.url ?? url}</span>
          <span className={styles.placeholderHint}>
            {browserTab?.isLoading ? 'Loading...' : 'Browser rendering via Tauri webview'}
          </span>
        </div>
      </div>
    </div>
  )
})
