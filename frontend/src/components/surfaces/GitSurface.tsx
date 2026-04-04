import { memo } from 'react'
import { GitBranch, ArrowUp, ArrowDown, Circle, Plus, Minus, Check } from 'lucide-react'
import type { Tab } from '@/types'
import { useGitStore } from '@/stores/git'
import styles from './GitSurface.module.css'

interface Props {
  tab: Tab
}

const STATUS_ICON: Record<string, typeof Circle> = {
  modified: Circle,
  added: Plus,
  deleted: Minus,
}

const STATUS_COLOR: Record<string, string> = {
  modified: 'var(--git-modified)',
  added: 'var(--git-added)',
  deleted: 'var(--git-deleted)',
  untracked: 'var(--git-untracked)',
  conflict: 'var(--git-conflict)',
  renamed: 'var(--git-renamed)',
}

export const GitSurface = memo(function GitSurface({ tab }: Props) {
  const state = useGitStore((s) => s.gitState.get(tab.projectId))
  if (!state) return <div className={styles.empty}>No git state</div>

  const staged = state.changes.filter((c) => c.staged)
  const unstaged = state.changes.filter((c) => !c.staged)

  return (
    <div className={styles.surface}>
      <div className={styles.header}>
        <GitBranch size={14} />
        <span className={styles.branch}>{state.branch}</span>
        {state.ahead > 0 && <span className={styles.sync}><ArrowUp size={11} />{state.ahead}</span>}
        {state.behind > 0 && <span className={styles.sync}><ArrowDown size={11} />{state.behind}</span>}
      </div>
      <div className={styles.commitArea}>
        <textarea className={styles.commitInput} placeholder="Enter commit message" rows={3} />
        <button className={styles.commitBtn}>
          <Check size={13} />
          <span>Commit</span>
        </button>
      </div>
      <div className={styles.changes}>
        {staged.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupHeader}>Staged ({staged.length})</div>
            {staged.map((c) => {
              const Icon = STATUS_ICON[c.status] ?? Circle
              return (
                <div key={c.path} className={styles.changeRow}>
                  <Icon size={11} style={{ color: STATUS_COLOR[c.status] }} />
                  <span className={styles.changePath}>{c.path}</span>
                  <span className={styles.changeStatus} style={{ color: STATUS_COLOR[c.status] }}>
                    {c.status.charAt(0).toUpperCase()}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {unstaged.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupHeader}>Changed ({unstaged.length})</div>
            {unstaged.map((c) => {
              const Icon = STATUS_ICON[c.status] ?? Circle
              return (
                <div key={c.path} className={styles.changeRow}>
                  <Icon size={11} style={{ color: STATUS_COLOR[c.status] }} />
                  <span className={styles.changePath}>{c.path}</span>
                  <span className={styles.changeStatus} style={{ color: STATUS_COLOR[c.status] }}>
                    {c.status.charAt(0).toUpperCase()}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})
