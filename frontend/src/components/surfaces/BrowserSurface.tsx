import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Lock, Globe, ExternalLink, Search, X, AlertTriangle, Pin } from 'lucide-react'
import type { Tab } from '@/types'
import {
  browserRendererAttach,
  browserRendererBoundsSet,
  browserRendererDetach,
  browserFindInPage,
  listenBrowserEvents,
  browserTabBack,
  browserTabForward,
  browserTabNavigate,
  browserTabOpenExternal,
  browserTabPinSet,
  browserTabReload,
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
  const [findQuery, setFindQuery] = useState('')
  const [findResult, setFindResult] = useState<string | null>(null)
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  const rendererId = useMemo(() => (
    browserTabId ? `renderer-${browserTabId}-${tab.id}` : undefined
  ), [browserTabId, tab.id])

  const url = draftUrl ?? browserTab?.url ?? (tab.meta?.url as string) ?? 'https://example.com'

  useEffect(() => {
    if (!browserTabId || !rendererId) return
    let disposed = false
    void browserRendererAttach(browserTabId, rendererId, tab.id)
      .catch((error: unknown) => {
        if (!disposed) {
          setSurfaceError(error instanceof Error ? error.message : 'Failed to attach native browser renderer')
        }
      })
    return () => {
      disposed = true
      void browserRendererDetach(browserTabId)
    }
  }, [browserTabId, rendererId, tab.id])

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
            setSurfaceError(error instanceof Error ? error.message : 'Failed to position native browser renderer')
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
  }, [browserTabId, browserTab?.url])

  useEffect(() => {
    if (!browserTabId) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void listenBrowserEvents((payload) => {
      if (disposed) return
      if (payload.type === 'findInPageResult' && payload.result?.tabId === browserTabId) {
        setFindResult(
          payload.result.matches > 0
            ? `${payload.result.activeMatchOrdinal}/${payload.result.matches} matches`
            : 'No matches',
        )
        return
      }
      if (payload.type === 'downloadRequested' && payload.request?.tabId === browserTabId) {
        const filename = 'suggestedFilename' in payload.request ? payload.request.suggestedFilename : null
        const label = filename || payload.request.url
        setDownloadNotice(`Download requested: ${label}`)
      }
    }).then((dispose) => {
      unlisten = dispose
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [browserTabId])

  const runFindInPage = async (mode: 'first' | 'next') => {
    if (!browserTabId) return
    const query = findQuery.trim()
    if (!query) {
      setFindResult(null)
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
                  setSurfaceError(error instanceof Error ? error.message : 'Failed to open external browser')
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
          {findResult && <span className={styles.findResult}>{findResult}</span>}
          {findQuery && (
            <button
              className={styles.findClear}
              onClick={() => {
                setFindQuery('')
                setFindResult(null)
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
        {downloadNotice && (
          <div className={styles.downloadBanner}>
            <span>{downloadNotice}</span>
            <button
              className={styles.downloadDismiss}
              onClick={() => setDownloadNotice(null)}
              aria-label="Dismiss download notice"
            >
              <X size={11} />
            </button>
          </div>
        )}
        <div
          ref={viewportRef}
          className={styles.nativeViewport}
          aria-label={browserTab?.title ?? tab.title}
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
