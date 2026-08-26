import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Upload } from 'lucide-react'
import { ensureEditorDocument, scheduleEditorPrefetch } from '@/lib/editorDocuments'
import { fileImportExternal, projectTreeReadNested, toFileTree } from '@/lib/backend'
import { runFileMutationWithRefresh } from '@/lib/fileMutationState'
import { openOrFocusEditorWorkspaceTab } from '@/lib/workspaceTabs'
import { useNotificationsStore } from '@/stores/notifications'
import type { FileEntry, ProjectId } from '@/types'
import { useFilesStore } from '@/stores/files'
import styles from './FileTree.module.css'

interface Props {
  projectId: ProjectId
}

const GIT_STATUS_COLOR: Record<string, string> = {
  modified: 'var(--git-modified)',
  added: 'var(--git-added)',
  deleted: 'var(--git-deleted)',
  untracked: 'var(--git-untracked)',
  renamed: 'var(--git-renamed)',
  conflict: 'var(--git-conflict)',
}

const FileRow = memo(function FileRow({
  entry,
  projectId,
  selectedPath,
  onSelect,
  onToggle,
  onWarm,
}: {
  entry: FileEntry
  projectId: ProjectId
  selectedPath: string | null
  onSelect: (path: string) => void
  onToggle: (path: string) => void
  onWarm: (path: string) => void
}) {
  const isSelected = entry.path === selectedPath
  const statusColor = entry.gitStatus ? GIT_STATUS_COLOR[entry.gitStatus] : undefined

  return (
    <>
      <button
        className={`${styles.row} ${isSelected ? styles.selected : ''}`}
        style={{ paddingLeft: `${entry.depth * 16 + 8}px` }}
        onClick={() => {
          if (entry.isDir) onToggle(entry.path)
          else onSelect(entry.path)
        }}
        onMouseEnter={() => !entry.isDir && onWarm(entry.path)}
        onFocus={() => !entry.isDir && onWarm(entry.path)}
      >
        {entry.isDir ? (
          <>
            {entry.expanded ? <ChevronDown size={12} className={styles.chevron} /> : <ChevronRight size={12} className={styles.chevron} />}
            {entry.expanded ? <FolderOpen size={14} className={styles.folderIcon} /> : <Folder size={14} className={styles.folderIcon} />}
          </>
        ) : (
          <>
            <span className={styles.chevronSpace} />
            <File size={14} className={styles.fileIcon} />
          </>
        )}
        <span className={styles.name} style={statusColor ? { color: statusColor } : undefined}>
          {entry.name}
        </span>
        {entry.gitStatus && (
          <span className={styles.gitIndicator} style={{ color: statusColor }}>
            {entry.gitStatus.charAt(0).toUpperCase()}
          </span>
        )}
      </button>
      {entry.isDir && entry.expanded && entry.children?.map((child) => (
        <FileRow
          key={child.path}
          entry={child}
          projectId={projectId}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onToggle={onToggle}
          onWarm={onWarm}
        />
      ))}
    </>
  )
})

export const FileTree = memo(function FileTree({ projectId }: Props) {
  const tree = useFilesStore((s) => s.trees.get(projectId))
  const selectedPath = useFilesStore((s) => s.selectedPath.get(projectId) ?? null)
  const hydrateTree = useFilesStore((s) => s.hydrateTree)
  const toggleExpand = useFilesStore((s) => s.toggleExpand)
  const setSelected = useFilesStore((s) => s.setSelected)
  const pushError = useNotificationsStore((s) => s.pushError)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const visibleLeafPaths = useMemo(() => collectVisibleLeafPaths(tree ?? []).slice(0, 8), [tree])

  const onSelect = useCallback(
    (path: string) => {
      setSelected(projectId, path)
      void ensureEditorDocument(projectId, path)
      const name = path.split('/').pop() ?? path
      openOrFocusEditorWorkspaceTab(projectId, name, path)
    },
    [projectId, setSelected]
  )

  const onToggle = useCallback(
    (path: string) => {
      toggleExpand(projectId, path)
    },
    [projectId, toggleExpand]
  )

  const onWarm = useCallback(
    (path: string) => {
      scheduleEditorPrefetch(projectId, [path], { priority: true })
    },
    [projectId],
  )

  useEffect(() => {
    if (!tree || visibleLeafPaths.length === 0) return
    scheduleEditorPrefetch(projectId, visibleLeafPaths)
  }, [projectId, tree, visibleLeafPaths])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const importExternalPaths = useCallback(
    async (sourcePaths: string[]) => {
      const normalized = Array.from(new Set(sourcePaths.filter((path) => path.trim().length > 0)))
      if (normalized.length === 0) {
        return
      }

      setIsImporting(true)
      await runFileMutationWithRefresh({
        mutate: () => fileImportExternal({
          projectId,
          sourcePaths: normalized,
        }),
        refresh: async () => {
          const nextTree = await projectTreeReadNested(projectId)
          hydrateTree(projectId, toFileTree(nextTree))
        },
        onMutationError: (error) => {
          const message = error instanceof Error ? error.message : 'Failed to import files'
          pushError('File import failed', error, message)
        },
        onRefreshError: (error) => {
          const message = error instanceof Error ? error.message : 'Project tree refresh failed'
          pushError('Project tree refresh failed', error, message)
        },
      }).finally(() => {
        setIsImporting(false)
      })
    },
    [hydrateTree, projectId, pushError],
  )

  const onOpenImporter = useCallback(async (mode: 'files' | 'folders') => {
    if (isImporting) return
    try {
      const selection = await openDialog({
        multiple: true,
        directory: mode === 'folders',
        title: mode === 'folders' ? 'Select folders to import' : 'Select files to import',
      })
      if (typeof selection === 'string') {
        await importExternalPaths([selection])
        return
      }
      if (Array.isArray(selection) && selection.length > 0) {
        await importExternalPaths(selection)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open file picker'
      pushError('File picker failed', error, message)
    }
  }, [importExternalPaths, isImporting, pushError])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const sourcePaths = files
      .map(getExternalFilePath)
      .filter((path): path is string => Boolean(path))

    if (sourcePaths.length !== files.length) {
      pushError(
        'File import failed',
        new Error('The dropped items did not expose absolute filesystem paths to the desktop runtime.'),
        'Use the system file picker to import these files.',
      )
      return
    }

    void importExternalPaths(sourcePaths)
  }, [importExternalPaths, pushError])

  if (!tree || tree.length === 0) {
    return (
      <div
        className={`${styles.dropZone} ${isDragOver ? styles.dropZoneActive : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <Upload size={16} className={styles.dropIcon} />
        <span className={styles.dropText}>Drop files or folders here</span>
        <span className={styles.dropHint}>or import directly from the system picker</span>
        <div className={styles.dropActions}>
          <button
            className={styles.dropButton}
            type="button"
            disabled={isImporting}
            onClick={() => void onOpenImporter('files')}
          >
            Import Files
          </button>
          <button
            className={styles.dropButton}
            type="button"
            disabled={isImporting}
            onClick={() => void onOpenImporter('folders')}
          >
            Import Folders
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`${styles.tree} ${isDragOver ? styles.treeDropActive : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {tree.map((entry) => (
        <FileRow
          key={entry.path}
          entry={entry}
          projectId={projectId}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onToggle={onToggle}
          onWarm={onWarm}
        />
      ))}
    </div>
  )
})

function collectVisibleLeafPaths(entries: FileEntry[]): string[] {
  const paths: string[] = []
  for (const entry of entries) {
    if (entry.isDir) {
      if (entry.expanded && entry.children) {
        paths.push(...collectVisibleLeafPaths(entry.children))
      }
      continue
    }
    paths.push(entry.path)
  }
  return paths
}

function getExternalFilePath(file: File): string | null {
  const candidate = Reflect.get(file, 'path')
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}
