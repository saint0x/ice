import { memo, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bug, CheckCircle, FileSearch, FolderPlus, FolderTree, Loader2, Pencil, PlaySquare, Trash2 } from 'lucide-react'
import type { Tab } from '@/types'
import { createAndFocusTerminalSession } from '@/lib/terminalSessions'
import {
  approvalAuditList,
  appHealth,
  codexRuntimeInfo,
  codexStatus,
  dirCreate,
  entryDelete,
  entryRename,
  fileSearchPaths,
  fileSearchText,
  projectSnapshot,
  projectTreeReadNested,
  toFileTree,
} from '@/lib/backend'
import { ensureEditorDocument } from '@/lib/editorDocuments'
import { resolveDeleteIntent } from '@/lib/fileMutationState'
import { closeWorkspaceTabsForEditorPath, openOrFocusEditorWorkspaceTab, renameWorkspaceEditorPath } from '@/lib/workspaceTabs'
import { tabMetaUtilityTool } from '@/lib/tabMeta'
import { useNotificationsStore } from '@/stores/notifications'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import { FileTree } from '@/components/sidebar/FileTree'
import styles from './SettingsSurface.module.css'

interface Props {
  tab: Tab
}

const EMPTY_TREE = [] as const

export const SettingsSurface = memo(function SettingsSurface({ tab }: Props) {
  const tool = tabMetaUtilityTool(tab)
  const storedTree = useFilesStore((state) => state.trees.get(tab.projectId))
  const selectedPath = useFilesStore((state) => state.selectedPath.get(tab.projectId) ?? null)
  const hydrateTree = useFilesStore((state) => state.hydrateTree)
  const setSelected = useFilesStore((state) => state.setSelected)
  const removeEditorDocument = useEditorStore((state) => state.removeDocument)
  const renameEditorDocument = useEditorStore((state) => state.renameDocument)
  const pushError = useNotificationsStore((state) => state.pushError)
  const tree = storedTree ?? EMPTY_TREE

  const [query, setQuery] = useState('')
  const [newDirPath, setNewDirPath] = useState('')
  const [renamePath, setRenamePath] = useState('')
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
  const [isFileMutating, setIsFileMutating] = useState(false)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const [deleteArmedPath, setDeleteArmedPath] = useState<string | null>(null)

  useEffect(() => {
    setRenamePath(selectedPath ?? '')
    setDeleteArmedPath(null)
  }, [selectedPath])

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
        const message = error instanceof Error ? error.message : 'Failed to load utility surface'
        setSurfaceError(message)
        pushError('Utility surface failed', error, message)
        setIsLoading(false)
      }
    })

    return () => {
      disposed = true
    }
  }, [pushError, tab.projectId, tool])

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
      const message = error instanceof Error ? error.message : 'Search failed'
      setSurfaceError(message)
      pushError('Project search failed', error, message)
    } finally {
      setIsLoading(false)
    }
  }

  const openEditor = (path: string) => {
    void ensureEditorDocument(tab.projectId, path)
    const name = path.split('/').pop() ?? path
    openOrFocusEditorWorkspaceTab(tab.projectId, name, path)
  }

  const createTerminal = async () => {
    setIsLoading(true)
    setSurfaceError(null)
    try {
      await createAndFocusTerminalSession(tab.projectId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create terminal'
      setSurfaceError(message)
      pushError('Terminal launch failed', error, message)
    } finally {
      setIsLoading(false)
    }
  }

  const refreshFiles = async () => {
    const nextTree = await projectTreeReadNested(tab.projectId)
    hydrateTree(tab.projectId, toFileTree(nextTree))
  }

  const createDirectory = async () => {
    const path = normalizeRelativePath(newDirPath)
    if (!path) return
    setIsFileMutating(true)
    setSurfaceError(null)
    try {
      await dirCreate({ projectId: tab.projectId, path })
      setNewDirPath('')
      await refreshFiles()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create folder'
      setSurfaceError(message)
      pushError('Folder create failed', error, message)
    } finally {
      setIsFileMutating(false)
    }
  }

  const renameSelectedFile = async () => {
    if (!selectedPath) return
    const to = normalizeRelativePath(renamePath)
    if (!to || to === selectedPath) return
    setIsFileMutating(true)
    setSurfaceError(null)
    try {
      await entryRename({ projectId: tab.projectId, from: selectedPath, to })
      renameEditorDocument(tab.projectId, selectedPath, to)
      renameWorkspaceEditorPath(tab.projectId, selectedPath, to)
      setSelected(tab.projectId, to)
      await refreshFiles()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename file'
      setSurfaceError(message)
      pushError('File rename failed', error, message)
    } finally {
      setIsFileMutating(false)
    }
  }

  const deleteSelectedFile = async () => {
    const intent = resolveDeleteIntent(selectedPath, deleteArmedPath)
    setDeleteArmedPath(intent.armedPath)
    if (!selectedPath || !intent.confirmed) return

    setIsFileMutating(true)
    setSurfaceError(null)
    try {
      await entryDelete({ projectId: tab.projectId, path: selectedPath })
      removeEditorDocument(tab.projectId, selectedPath)
      closeWorkspaceTabsForEditorPath(tab.projectId, selectedPath)
      await refreshFiles()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete file'
      setSurfaceError(message)
      pushError('File delete failed', error, message)
    } finally {
      setDeleteArmedPath(null)
      setIsFileMutating(false)
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
            <div className={styles.fileActions}>
              <div className={styles.inlineAction}>
                <input
                  className={styles.compactInput}
                  value={newDirPath}
                  onChange={(event) => setNewDirPath(event.target.value)}
                  placeholder="new/folder"
                  spellCheck={false}
                  disabled={isFileMutating}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void createDirectory()
                    }
                  }}
                />
                <button className={styles.iconBtn} title="Create folder" onClick={() => void createDirectory()} disabled={isFileMutating || !normalizeRelativePath(newDirPath)}>
                  {isFileMutating ? <Loader2 size={12} className={styles.spinner} /> : <FolderPlus size={12} />}
                </button>
              </div>
              <div className={styles.inlineAction}>
                <input
                  className={styles.compactInput}
                  value={renamePath}
                  onChange={(event) => setRenamePath(event.target.value)}
                  placeholder="selected/path.ts"
                  spellCheck={false}
                  disabled={isFileMutating || !selectedPath}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void renameSelectedFile()
                    }
                  }}
                />
                <button className={styles.iconBtn} title="Rename selected file" onClick={() => void renameSelectedFile()} disabled={isFileMutating || !selectedPath || !normalizeRelativePath(renamePath) || normalizeRelativePath(renamePath) === selectedPath}>
                  <Pencil size={12} />
                </button>
                <button
                  className={`${styles.iconBtn} ${deleteArmedPath === selectedPath ? styles.dangerArmed : ''}`}
                  title={deleteArmedPath === selectedPath ? 'Confirm delete selected file' : 'Delete selected file'}
                  onClick={() => void deleteSelectedFile()}
                  disabled={isFileMutating || !selectedPath}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
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

function normalizeRelativePath(path: string) {
  return path
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
}
