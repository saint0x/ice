import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Lock, Globe, ExternalLink, Search, X, AlertTriangle, Pin } from 'lucide-react'
import type { Tab } from '@/types'
import {
  browserRendererAttach,
  browserRendererDetach,
  browserFindInPage,
  browserFindInPageReport,
  browserTabBack,
  browserTabForward,
  browserTabNavigate,
  browserTabOpenExternal,
  browserTabPinSet,
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
  const [findQuery, setFindQuery] = useState('')
  const [findResult, setFindResult] = useState<string | null>(null)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
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
    try {
      const targetWindow = iframeRef.current?.contentWindow
      const targetDocument = iframeRef.current?.contentDocument
      if (!targetWindow || !targetDocument) {
        throw new Error('Browser renderer is unavailable')
      }
      const haystack = targetDocument.body?.innerText ?? ''
      const matches = countMatches(haystack, query)
      const targetWindowWithFind = targetWindow as Window & {
        find?: (
          searchString: string,
          caseSensitive?: boolean,
          backwards?: boolean,
          wrapAround?: boolean,
          wholeWord?: boolean,
          searchInFrames?: boolean,
          showDialog?: boolean,
        ) => boolean
      }
      const found = typeof targetWindowWithFind.find === 'function'
        ? targetWindowWithFind.find(query, false, false, mode === 'next', false, false, false)
        : matches > 0
      const result = await browserFindInPageReport({
        tabId: browserTabId,
        query,
        matches,
        activeMatchOrdinal: found ? 1 : 0,
        finalUpdate: true,
      })
      setFindResult(result.matches > 0 ? `${result.activeMatchOrdinal}/${result.matches} matches` : 'No matches')
    } catch {
      await browserFindInPageReport({
        tabId: browserTabId,
        query,
        matches: 0,
        activeMatchOrdinal: 0,
        finalUpdate: true,
      }).catch(() => {})
      setFindResult('Find unavailable for this page')
    }
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

function countMatches(haystack: string, needle: string) {
  if (!needle) return 0
  const pattern = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = haystack.match(new RegExp(pattern, 'gi'))
  return matches?.length ?? 0
}
