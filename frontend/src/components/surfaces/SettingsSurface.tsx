import { memo, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bug, CheckCircle, FileSearch, FolderTree, Loader2, PlaySquare } from 'lucide-react'
import type { Tab } from '@/types'
import {
  approvalAuditList,
  appHealth,
  codexRuntimeInfo,
  codexStatus,
  fileSearchPaths,
  fileSearchText,
  projectSnapshot,
  terminalCreate,
  toTerminalSession,
} from '@/lib/backend'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTerminalStore } from '@/stores/terminal'
import { useFilesStore } from '@/stores/files'
import { FileTree } from '@/components/sidebar/FileTree'
import styles from './SettingsSurface.module.css'

interface Props {
  tab: Tab
}

type UtilityTool = 'files' | 'search' | 'diagnostics' | 'debug'

export const SettingsSurface = memo(function SettingsSurface({ tab }: Props) {
  const tool = ((tab.meta?.tool as UtilityTool | undefined) ?? 'diagnostics')
  const openTab = useWorkspaceStore((state) => state.openTab)
  const activePaneId = useWorkspaceStore((state) => state.activePaneId)
  const upsertSession = useTerminalStore((state) => state.upsertSession)
  const setActiveSession = useTerminalStore((state) => state.setActiveSession)
  const tree = useFilesStore((state) => state.trees.get(tab.projectId) ?? [])

  const [query, setQuery] = useState('')
  const [pathResults, setPathResults] = useState<string[]>([])
  const [textResults, setTextResults] = useState<Array<{
    path: string
    lineNumber: number
    line: string
    submatches: Array<{ start: number; end: number; text: string }>
  }>>([])
  const [health, setHealth] = useState<Record<string, unknown> | null>(null)
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<Record<string, unknown> | null>(null)
  const [auditLog, setAuditLog] = useState<Array<Record<string, unknown>>>([])
  const [debugSnapshot, setDebugSnapshot] = useState<Record<string, unknown> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)

  useEffect(() => {
    if (tool !== 'diagnostics' && tool !== 'debug') return
    let disposed = false
    setIsLoading(true)
    setSurfaceError(null)

    const load = async () => {
      if (tool === 'diagnostics') {
        const [nextHealth, nextStatus, nextRuntime, nextAudit] = await Promise.all([
          appHealth(),
          codexStatus(),
          codexRuntimeInfo(),
          approvalAuditList(tab.projectId),
        ])
        if (disposed) return
        setHealth(nextHealth as unknown as Record<string, unknown>)
        setStatus(nextStatus)
        setRuntimeInfo(nextRuntime)
        setAuditLog(nextAudit as unknown as Array<Record<string, unknown>>)
      } else {
        const snapshot = await projectSnapshot(tab.projectId, 4)
        if (disposed) return
        setDebugSnapshot(snapshot)
      }
      setIsLoading(false)
    }

    void load().catch((error: unknown) => {
      if (!disposed) {
        setSurfaceError(error instanceof Error ? error.message : 'Failed to load utility surface')
        setIsLoading(false)
      }
    })

    return () => {
      disposed = true
    }
  }, [tab.projectId, tool])

  const treeStats = useMemo(() => {
    let files = 0
    let dirs = 0
    const visit = (entries: typeof tree) => {
      for (const entry of entries) {
        if (entry.isDir) {
          dirs += 1
          visit(entry.children ?? [])
        } else {
          files += 1
        }
      }
    }
    visit(tree)
    return { files, dirs }
  }, [tree])

  const runSearch = async () => {
    const normalized = query.trim()
    if (!normalized) {
      setPathResults([])
      setTextResults([])
      return
    }
    setIsLoading(true)
    setSurfaceError(null)
    try {
      const [paths, text] = await Promise.all([
        fileSearchPaths(tab.projectId, normalized, 50),
        fileSearchText(tab.projectId, normalized, 50),
      ])
      setPathResults(paths.paths)
      setTextResults(text.matches)
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Search failed')
    } finally {
      setIsLoading(false)
    }
  }

  const openEditor = (path: string) => {
    const name = path.split('/').pop() ?? path
    openTab(activePaneId, 'editor', name, tab.projectId, { path })
  }

  const createTerminal = async () => {
    setIsLoading(true)
    setSurfaceError(null)
    try {
      const session = await terminalCreate(tab.projectId)
      const mapped = toTerminalSession(session)
      upsertSession(mapped)
      setActiveSession(tab.projectId, mapped.id)
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Failed to create terminal')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={styles.surface}>
      <div className={styles.header}>
        {tool === 'files' && <FolderTree size={14} />}
        {tool === 'search' && <FileSearch size={14} />}
        {tool === 'diagnostics' && <CheckCircle size={14} />}
        {tool === 'debug' && <Bug size={14} />}
        <span className={styles.title}>{tab.title}</span>
      </div>

      {surfaceError ? (
        <div className={styles.errorBanner}>
          <AlertTriangle size={13} />
          <span>{surfaceError}</span>
        </div>
      ) : null}

      {tool === 'files' ? (
        <div className={styles.filesLayout}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryRow}><span>Directories</span><strong>{treeStats.dirs}</strong></div>
            <div className={styles.summaryRow}><span>Files</span><strong>{treeStats.files}</strong></div>
            <button className={styles.actionBtn} onClick={() => void createTerminal()}>
              <PlaySquare size={12} />
              <span>Run in terminal</span>
            </button>
          </div>
          <div className={styles.treePanel}>
            <FileTree projectId={tab.projectId} />
          </div>
        </div>
      ) : null}

      {tool === 'search' ? (
        <div className={styles.searchLayout}>
          <div className={styles.searchBar}>
            <input
              className={styles.searchInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files and contents"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void runSearch()
                }
              }}
            />
            <button className={styles.actionBtn} onClick={() => void runSearch()} disabled={isLoading}>
              {isLoading ? <Loader2 size={12} className={styles.spinner} /> : <FileSearch size={12} />}
              <span>Search</span>
            </button>
          </div>
          <div className={styles.resultsGrid}>
            <div className={styles.resultsPanel}>
              <div className={styles.panelTitle}>Path Matches</div>
              {pathResults.length > 0 ? pathResults.map((path) => (
                <button key={path} className={styles.resultRow} onClick={() => openEditor(path)}>
                  <span className={styles.resultPath}>{path}</span>
                </button>
              )) : (
                <div className={styles.emptyState}>Run a search to see matching file paths.</div>
              )}
            </div>
            <div className={styles.resultsPanel}>
              <div className={styles.panelTitle}>Content Matches</div>
              {textResults.length > 0 ? textResults.map((match) => (
                <button
                  key={`${match.path}:${match.lineNumber}:${match.line}`}
                  className={styles.resultBlock}
                  onClick={() => openEditor(match.path)}
                >
                  <div className={styles.resultHeading}>
                    <span className={styles.resultPath}>{match.path}</span>
                    <span className={styles.resultMeta}>Line {match.lineNumber}</span>
                  </div>
                  <pre className={styles.resultLine}>{match.line}</pre>
                </button>
              )) : (
                <div className={styles.emptyState}>Run a search to see matching file contents.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tool === 'diagnostics' ? (
        <div className={styles.diagnosticsLayout}>
          {isLoading ? <div className={styles.emptyState}>Loading diagnostics...</div> : null}
          {!isLoading && health ? (
            <>
              <div className={styles.card}>
                <div className={styles.panelTitle}>App Health</div>
                <pre className={styles.jsonBlock}>{JSON.stringify(health, null, 2)}</pre>
              </div>
              <div className={styles.card}>
                <div className={styles.panelTitle}>Codex Runtime</div>
                <pre className={styles.jsonBlock}>{JSON.stringify(runtimeInfo, null, 2)}</pre>
              </div>
              <div className={styles.card}>
                <div className={styles.panelTitle}>Codex Status</div>
                <pre className={styles.jsonBlock}>{JSON.stringify(status, null, 2)}</pre>
              </div>
              <div className={styles.card}>
                <div className={styles.panelTitle}>Approval Audit</div>
                {auditLog.length > 0 ? (
                  <pre className={styles.jsonBlock}>{JSON.stringify(auditLog, null, 2)}</pre>
                ) : (
                  <div className={styles.emptyState}>No approval audit records for this project yet.</div>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {tool === 'debug' ? (
        <div className={styles.debugLayout}>
          {isLoading ? (
            <div className={styles.emptyState}>Loading project snapshot...</div>
          ) : debugSnapshot ? (
            <pre className={styles.jsonBlock}>{JSON.stringify(debugSnapshot, null, 2)}</pre>
          ) : (
            <div className={styles.emptyState}>No debug snapshot loaded.</div>
          )}
        </div>
      ) : null}
    </div>
  )
})
