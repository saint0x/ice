import { memo, useCallback } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react'
import type { FileEntry, ProjectId } from '@/types'
import { useFilesStore } from '@/stores/files'
import { useWorkspaceStore } from '@/stores/workspace'
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
}: {
  entry: FileEntry
  projectId: ProjectId
  selectedPath: string | null
  onSelect: (path: string) => void
  onToggle: (path: string) => void
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
            {entry.gitStatus[0].toUpperCase()}
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
        />
      ))}
    </>
  )
})

export const FileTree = memo(function FileTree({ projectId }: Props) {
  const tree = useFilesStore((s) => s.trees.get(projectId))
  const selectedPath = useFilesStore((s) => s.selectedPath.get(projectId) ?? null)
  const toggleExpand = useFilesStore((s) => s.toggleExpand)
  const setSelected = useFilesStore((s) => s.setSelected)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)

  const onSelect = useCallback(
    (path: string) => {
      setSelected(projectId, path)
      const name = path.split('/').pop() ?? path
      openTab(activePaneId, 'editor', name, projectId, { path })
    },
    [projectId, setSelected, openTab, activePaneId]
  )

  const onToggle = useCallback(
    (path: string) => {
      toggleExpand(projectId, path)
    },
    [projectId, toggleExpand]
  )

  if (!tree) return <div className={styles.empty}>No files loaded</div>

  return (
    <div className={styles.tree}>
      {tree.map((entry) => (
        <FileRow
          key={entry.path}
          entry={entry}
          projectId={projectId}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
})
