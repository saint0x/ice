import { memo } from 'react'
import { ArrowUp, ArrowDown, Circle, Plus, Minus, FileWarning } from 'lucide-react'
import type { ProjectId } from '@/types'
import { useGitStore } from '@/stores/git'
import styles from './GitSummary.module.css'

const STATUS_ICON: Record<string, typeof Circle> = {
  modified: Circle,
  added: Plus,
  deleted: Minus,
  conflict: FileWarning,
}

const STATUS_COLOR: Record<string, string> = {
  modified: 'var(--git-modified)',
  added: 'var(--git-added)',
  deleted: 'var(--git-deleted)',
  untracked: 'var(--git-untracked)',
  conflict: 'var(--git-conflict)',
  renamed: 'var(--git-renamed)',
}

export const GitSummary = memo(function GitSummary({ projectId }: { projectId: ProjectId }) {
  const state = useGitStore((s) => s.gitState.get(projectId))
  if (!state) return <div className={styles.empty}>No git info</div>

  const staged = state.changes.filter((c) => c.staged)
  const unstaged = state.changes.filter((c) => !c.staged)

  return (
    <div className={styles.summary}>
      <div className={styles.branchRow}>
        <span className={styles.branchName}>{state.branch}</span>
        {state.ahead > 0 && (
          <span className={styles.syncBadge}>
            <ArrowUp size={10} />{state.ahead}
          </span>
        )}
        {state.behind > 0 && (
          <span className={styles.syncBadge}>
            <ArrowDown size={10} />{state.behind}
          </span>
        )}
      </div>
      {staged.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupLabel}>Staged</div>
          {staged.map((c) => {
            const Icon = STATUS_ICON[c.status] ?? Circle
            return (
              <div key={c.path} className={styles.changeRow}>
                <Icon size={10} style={{ color: STATUS_COLOR[c.status] }} />
                <span className={styles.changePath}>{c.path.split('/').pop()}</span>
              </div>
            )
          })}
        </div>
      )}
      {unstaged.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupLabel}>Changed</div>
          {unstaged.map((c) => {
            const Icon = STATUS_ICON[c.status] ?? Circle
            return (
              <div key={c.path} className={styles.changeRow}>
                <Icon size={10} style={{ color: STATUS_COLOR[c.status] }} />
                <span className={styles.changePath}>{c.path.split('/').pop()}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
