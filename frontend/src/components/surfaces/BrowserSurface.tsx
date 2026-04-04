import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Lock, Globe, ExternalLink } from 'lucide-react'
import type { Tab } from '@/types'
import {
  browserRendererAttach,
  browserRendererDetach,
  browserTabBack,
  browserTabForward,
  browserTabNavigate,
  browserTabOpenExternal,
  browserTabReload,
  browserTabRendererStateSet,
  toBrowserTab,
} from '@/lib/backend'
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
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const rendererId = useMemo(() => (
    browserTabId ? `renderer-${browserTabId}` : undefined
  ), [browserTabId])

  const url = draftUrl ?? browserTab?.url ?? (tab.meta?.url as string) ?? 'https://example.com'

  useEffect(() => {
    if (!browserTabId || !rendererId) return
    void browserRendererAttach(browserTabId, rendererId, tab.id)
    return () => {
      void browserRendererDetach(browserTabId)
    }
  }, [browserTabId, rendererId, tab.id])

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
          <button
            className={styles.navBtn}
            aria-label="Open in external browser"
            onClick={() => {
              if (!browserTabId) return
              void browserTabOpenExternal(browserTabId)
            }}
          >
            <ExternalLink size={13} />
          </button>
        </div>
        <div className={styles.addressBar}>
          {(browserTab?.isSecure ?? false)
            ? <Lock size={11} className={styles.lockIcon} />
            : <Globe size={11} className={styles.lockIcon} />}
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
        <iframe
          ref={iframeRef}
          key={browserTabId ?? tab.id}
          className={styles.frame}
          src={browserTab?.url ?? url}
          title={browserTab?.title ?? tab.title}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => {
            if (!browserTabId) return
            const currentUrl = iframeRef.current?.src ?? browserTab?.url ?? url
            const isSecure =
              currentUrl.startsWith('https://') ||
              currentUrl.startsWith('about:') ||
              currentUrl.startsWith('tauri://')
            const securityOrigin = safeBrowserOrigin(currentUrl)
            void browserTabRendererStateSet({
              tabId: browserTabId,
              url: currentUrl,
              title: browserTab?.title ?? tab.title,
              isLoading: false,
              securityOrigin,
              isSecure,
            }).then((next) => upsertBrowserTab(toBrowserTab(next))).catch(() => {})
          }}
        />
        <div className={styles.overlay}>
          <Globe size={12} className={styles.overlayIcon} />
          <span className={styles.overlayText}>
            {browserTab?.isLoading ? 'Loading...' : browserTab?.url ?? url}
          </span>
        </div>
      </div>
    </div>
  )
})

function safeBrowserOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}
