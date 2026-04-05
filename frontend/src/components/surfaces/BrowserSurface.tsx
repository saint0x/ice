import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Lock, Globe, ExternalLink, Search, X, AlertTriangle, Pin, Download, Info } from 'lucide-react'
import type { Tab } from '@/types'
import {
  browserRendererAttach,
  browserRendererBoundsSet,
  browserRendererDetach,
  browserFindInPage,
  browserTabBack,
  browserTabForward,
  browserTabNavigate,
  browserTabOpenExternal,
  browserTabPinSet,
  browserTabReload,
  toBrowserTab,
} from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
import { useNotificationsStore } from '@/stores/notifications'
import styles from './BrowserSurface.module.css'

interface Props {
  tab: Tab
}

export const BrowserSurface = memo(function BrowserSurface({ tab }: Props) {
  const browserTabId = tab.meta?.tabId as string | undefined
  const browserTab = useBrowserStore((s) => browserTabId ? s.tabs.get(browserTabId) : undefined)
  const upsertBrowserTab = useBrowserStore((s) => s.upsertTab)
  const runtimeNotices = useBrowserStore((s) => browserTabId ? s.runtimeNotices.get(browserTabId) ?? [] : [])
  const dismissRuntimeNotice = useBrowserStore((s) => s.dismissRuntimeNotice)
  const pushError = useNotificationsStore((s) => s.pushError)
  const [draftUrl, setDraftUrl] = useState<string | null>(null)
  const [findQuery, setFindQuery] = useState('')
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  const rendererId = useMemo(() => (
    browserTabId ? `renderer-${browserTabId}-${tab.id}` : undefined
  ), [browserTabId, tab.id])
  const latestFindResult = useMemo(
    () => runtimeNotices.find((notice) => notice.kind === 'findResult'),
    [runtimeNotices],
  )
  const visibleNotices = useMemo(
    () => runtimeNotices.filter((notice) => notice.kind !== 'findResult').slice(0, 3),
    [runtimeNotices],
  )

  const url = draftUrl ?? browserTab?.url ?? (tab.meta?.url as string) ?? 'https://example.com'

  useEffect(() => {
    if (!browserTabId || !rendererId) return
    let disposed = false
    void browserRendererAttach(browserTabId, rendererId, tab.id)
      .catch((error: unknown) => {
        if (!disposed) {
          const message = error instanceof Error ? error.message : 'Failed to attach native browser renderer'
          setSurfaceError(message)
          pushError('Browser renderer attach failed', error, message)
        }
      })
    return () => {
      disposed = true
      void browserRendererDetach(browserTabId)
    }
  }, [browserTabId, pushError, rendererId, tab.id])

  useEffect(() => {
    if (!browserTabId || !viewportRef.current) return
    const element = viewportRef.current
    let disposed = false

    const syncBounds = () => {
      if (disposed) return
      const rect = element.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      void browserRendererBoundsSet(browserTabId, rect.left, rect.top, rect.width, rect.height)
        .catch((error: unknown) => {
          if (!disposed) {
            const message = error instanceof Error ? error.message : 'Failed to position native browser renderer'
            setSurfaceError(message)
            pushError('Browser renderer bounds failed', error, message)
          }
        })
    }

    const animationFrame = window.requestAnimationFrame(syncBounds)
    const observer = new ResizeObserver(syncBounds)
    observer.observe(element)
    window.addEventListener('resize', syncBounds)
    return () => {
      disposed = true
      window.cancelAnimationFrame(animationFrame)
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
    }
  }, [browserTabId, browserTab?.url, pushError])

  const runFindInPage = async (mode: 'first' | 'next') => {
    if (!browserTabId) return
    const query = findQuery.trim()
    if (!query) {
      return
    }
    setSurfaceError(null)
    await browserFindInPage({
      tabId: browserTabId,
      query,
      forward: true,
      findNext: mode === 'next',
    })
  }

  return (
    <div className={styles.surface}>
      {!browserTabId || !browserTab ? (
        <div className={styles.emptyState}>
          <Globe size={18} className={styles.emptyIcon} />
          <span className={styles.emptyTitle}>Browser tab unavailable</span>
          <span className={styles.emptyHint}>Reopen this browser tab from the sidebar or create a new one.</span>
        </div>
      ) : (
        <>
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
                .then((request) => {
                  window.open(request.url, '_blank', 'noopener,noreferrer')
                })
                .catch((error: unknown) => {
                  const message = error instanceof Error ? error.message : 'Failed to open external browser'
                  setSurfaceError(message)
                  pushError('External browser open failed', error, message)
                })
            }}
          >
            <ExternalLink size={13} />
          </button>
          <button
            className={styles.navBtn}
            aria-label={browserTab?.isPinned ? 'Unpin tab' : 'Pin tab'}
            onClick={() => {
              if (!browserTabId || !browserTab) return
              void browserTabPinSet(browserTabId, !browserTab.isPinned).then((next) => {
                upsertBrowserTab(toBrowserTab(next))
              })
            }}
          >
            <Pin size={13} fill={browserTab?.isPinned ? 'currentColor' : 'none'} />
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
        <div className={styles.findBar}>
          <Search size={11} className={styles.findIcon} />
          <input
            className={styles.findInput}
            value={findQuery}
            onChange={(event) => setFindQuery(event.target.value)}
            placeholder="Find in page"
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void runFindInPage(event.shiftKey ? 'next' : 'first')
              }
            }}
          />
          {latestFindResult?.message && (
            <span className={styles.findResult}>
              {latestFindResult.message}
            </span>
          )}
          {findQuery && (
            <button
              className={styles.findClear}
              onClick={() => {
                setFindQuery('')
              }}
              aria-label="Clear find"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.viewport}>
        {surfaceError && (
          <div className={styles.errorBanner}>
            <AlertTriangle size={12} />
            <span>{surfaceError}</span>
          </div>
        )}
        {visibleNotices.length > 0 ? (
          <div className={styles.noticeStack}>
            {visibleNotices.map((notice) => (
              <div
                key={notice.id}
                className={`${styles.runtimeNotice} ${notice.kind.includes('download') ? styles.downloadBanner : styles.infoBanner}`}
              >
                <div className={styles.noticeCopy}>
                  {notice.kind.includes('download') ? <Download size={12} /> : <Info size={12} />}
                  <span>{notice.message}</span>
                </div>
                <button
                  className={styles.downloadDismiss}
                  onClick={() => browserTabId && dismissRuntimeNotice(browserTabId, notice.id)}
                  aria-label="Dismiss browser notice"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div
          ref={viewportRef}
          className={styles.nativeViewport}
          aria-label={browserTab.title ?? tab.title}
        />
        <div className={styles.overlay}>
          <Globe size={12} className={styles.overlayIcon} />
          <span className={styles.overlayText}>
            {browserTab?.isLoading ? 'Loading...' : browserTab?.url ?? url}
          </span>
        </div>
      </div>
        </>
      )}
    </div>
  )
})
