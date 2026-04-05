import { memo, useEffect, useMemo, useState } from 'react'
import {
  GitBranch, ArrowUp, ArrowDown, Circle, Plus, Minus, Check, Loader2, RotateCcw, ArrowUpToLine, ArrowDownToLine, AlertTriangle, RefreshCcw, CloudDownload, CloudUpload, GitCommitHorizontal,
} from 'lucide-react'
import type { Tab } from '@/types'
import {
  gitBranchCheckout,
  gitBranchesList,
  gitCommit,
  gitCommitReadiness,
  gitDiffRead,
  gitDiffTreeRead,
  gitFetch,
  gitPull,
  gitPush,
  gitRestorePaths,
  gitStagePaths,
  gitUnstagePaths,
  toGitState,
} from '@/lib/backend'
import { useGitStore } from '@/stores/git'
import styles from './GitSurface.module.css'

interface Props {
  tab: Tab
}

type DiffMode = 'selected' | 'staged-tree' | 'unstaged-tree'

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
  const hydrateGitState = useGitStore((s) => s.hydrateGitState)
  const [commitMessage, setCommitMessage] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedDiff, setSelectedDiff] = useState<string>('')
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [isMutating, setIsMutating] = useState(false)
  const [diffMode, setDiffMode] = useState<DiffMode>('selected')
  const [branches, setBranches] = useState<Array<{
    name: string
    reference: string
    commit: string
    upstream?: string | null
    tracking?: string | null
    current: boolean
    isRemote: boolean
  }>>([])
  const [checkoutBranch, setCheckoutBranch] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [isBranchLoading, setIsBranchLoading] = useState(false)
  const [readiness, setReadiness] = useState<{
    authorConfigured: boolean
    commitMessageValid: boolean
    messageHint?: string | null
    blockingReason?: string | null
    authorName?: string | null
    authorEmail?: string | null
    activeHooks: string[]
  } | null>(null)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const selectedChange = useMemo(() => {
    if (!state || !selectedKey) return null
    return state.changes.find((change) => changeKey(change.path, change.staged) === selectedKey) ?? null
  }, [selectedKey, state])
  const currentBranchRecord = useMemo(
    () => branches.find((branch) => branch.current) ?? null,
    [branches],
  )

  useEffect(() => {
    if (!state) return
    let disposed = false
    void gitCommitReadiness(tab.projectId, commitMessage).then((result) => {
      if (!disposed) setReadiness(result)
    }).catch((error: unknown) => {
      if (!disposed) {
        setSurfaceError(error instanceof Error ? error.message : 'Failed to load commit readiness')
      }
    })
    return () => {
      disposed = true
    }
  }, [commitMessage, state, tab.projectId])

  useEffect(() => {
    if (!state) {
      setSelectedDiff('')
      return
    }

    if (diffMode === 'selected' && !selectedChange) {
      setSelectedDiff('')
      return
    }

    let disposed = false
    setIsDiffLoading(true)
    const request = diffMode === 'selected'
      ? gitDiffRead(tab.projectId, selectedChange!.path, selectedChange!.staged).then((result) => result.diff)
      : gitDiffTreeRead(tab.projectId, diffMode === 'staged-tree').then((records) => {
        if (records.length === 0) {
          return diffMode === 'staged-tree'
            ? 'No staged diff output.'
            : 'No unstaged diff output.'
        }
        return records
          .map((record) => `diff -- ${record.path}${record.staged ? ' (staged)' : ' (unstaged)'}\n${record.diff}`)
          .join('\n\n')
      })

    void request
      .then((result) => {
        if (!disposed) {
          setSelectedDiff(result)
          setIsDiffLoading(false)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSelectedDiff('')
          setSurfaceError(error instanceof Error ? error.message : 'Failed to load diff')
          setIsDiffLoading(false)
        }
      })
    return () => {
      disposed = true
    }
  }, [diffMode, selectedChange, state, tab.projectId])

  useEffect(() => {
    if (!state) return
    let disposed = false
    setIsBranchLoading(true)
    void gitBranchesList(tab.projectId)
      .then((result) => {
        if (!disposed) {
          const localBranches = result.filter((branch) => !branch.isRemote)
          setBranches(localBranches)
          const current = localBranches.find((branch) => branch.current)
          setCheckoutBranch(current?.name ?? state.branch)
          setIsBranchLoading(false)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSurfaceError(error instanceof Error ? error.message : 'Failed to load branches')
          setIsBranchLoading(false)
        }
      })
    return () => {
      disposed = true
    }
  }, [state, tab.projectId])

  if (!state) return <div className={styles.empty}>No git state</div>

  const staged = state.changes.filter((c) => c.staged)
  const unstaged = state.changes.filter((c) => !c.staged)
  const normalizedNewBranchName = newBranchName.trim()
  const branchExists = branches.some((branch) => branch.name === normalizedNewBranchName)
  const createBranchDisabled =
    isMutating ||
    isBranchLoading ||
    !normalizedNewBranchName ||
    branchExists ||
    /\s/.test(normalizedNewBranchName)

  const commitDisabled =
    isMutating ||
    staged.length === 0 ||
    !readiness?.authorConfigured ||
    !readiness?.commitMessageValid

  const applySummary = (summary: Awaited<ReturnType<typeof gitStagePaths>>) => {
    hydrateGitState(tab.projectId, toGitState(summary))
    setSurfaceError(null)
  }

  const runMutation = async (operation: () => Promise<Awaited<ReturnType<typeof gitStagePaths>>>) => {
    setIsMutating(true)
    try {
      const summary = await operation()
      applySummary(summary)
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Git operation failed')
    } finally {
      setIsMutating(false)
    }
  }

  const runBranchMutation = async (operation: () => Promise<Awaited<ReturnType<typeof gitStagePaths>>>) => {
    await runMutation(operation)
    try {
      const result = await gitBranchesList(tab.projectId)
      const localBranches = result.filter((branch) => !branch.isRemote)
      setBranches(localBranches)
      const current = localBranches.find((branch) => branch.current)
      setCheckoutBranch(current?.name ?? checkoutBranch)
      if (current?.name === normalizedNewBranchName) {
        setNewBranchName('')
      }
    } catch {
      // Keep the previous branch picker state if the refresh fails after mutation.
    }
  }

  const onCommit = async () => {
    if (commitDisabled) return
    setIsMutating(true)
    try {
      const summary = await gitCommit(tab.projectId, commitMessage)
      applySummary(summary)
      setCommitMessage('')
      setSelectedKey(null)
      setSelectedDiff('')
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Commit failed')
    } finally {
      setIsMutating(false)
    }
  }

  return (
    <div className={styles.surface}>
      <div className={styles.header}>
        <GitBranch size={14} />
        <span className={styles.branch}>{state.branch}</span>
        {currentBranchRecord?.upstream ? (
          <span className={styles.upstreamBadge}>
            <GitCommitHorizontal size={11} />
            <span>{currentBranchRecord.upstream}</span>
          </span>
        ) : (
          <span className={styles.warningBadge}>
            <AlertTriangle size={11} />
            <span>No upstream</span>
          </span>
        )}
        {currentBranchRecord?.tracking ? (
          <span className={styles.sync}>{currentBranchRecord.tracking}</span>
        ) : null}
        {state.ahead > 0 && <span className={styles.sync}><ArrowUp size={11} />{state.ahead}</span>}
        {state.behind > 0 && <span className={styles.sync}><ArrowDown size={11} />{state.behind}</span>}
      </div>
      <div className={styles.branchBar}>
        <div className={styles.branchPicker}>
          <select
            className={styles.branchSelect}
            value={checkoutBranch}
            onChange={(event) => setCheckoutBranch(event.target.value)}
            disabled={isMutating || isBranchLoading}
          >
            {branches.map((branch) => (
              <option key={branch.reference} value={branch.name}>{branch.name}</option>
            ))}
          </select>
          <button
            className={styles.syncBtn}
            onClick={() => void runBranchMutation(() => gitBranchCheckout({ projectId: tab.projectId, branchName: checkoutBranch }))}
            disabled={isMutating || isBranchLoading || !checkoutBranch || checkoutBranch === state.branch}
          >
            <RefreshCcw size={12} />
            <span>Checkout</span>
          </button>
        </div>
        <div className={styles.branchCreator}>
          <input
            className={styles.branchInput}
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            placeholder="new-branch-name"
            spellCheck={false}
          />
          <button
            className={styles.syncBtn}
            onClick={() => void runBranchMutation(() => gitBranchCheckout({
              projectId: tab.projectId,
              branchName: normalizedNewBranchName,
              create: true,
              startPoint: state.branch,
            }))}
            disabled={createBranchDisabled}
          >
            <Plus size={12} />
            <span>Create branch</span>
          </button>
        </div>
        <div className={styles.syncActions}>
          <button className={styles.syncBtn} onClick={() => void runBranchMutation(() => gitFetch(tab.projectId))} disabled={isMutating}>
            <CloudDownload size={12} />
            <span>Fetch</span>
          </button>
          <button className={styles.syncBtn} onClick={() => void runBranchMutation(() => gitPull({ projectId: tab.projectId, branch: state.branch }))} disabled={isMutating}>
            <ArrowDown size={12} />
            <span>Pull</span>
          </button>
          <button
            className={styles.syncBtn}
            onClick={() => void runBranchMutation(() => gitPush({
              projectId: tab.projectId,
              branch: state.branch,
              setUpstream: !currentBranchRecord?.upstream,
            }))}
            disabled={isMutating}
          >
            <CloudUpload size={12} />
            <span>{currentBranchRecord?.upstream ? 'Push' : 'Publish'}</span>
          </button>
        </div>
      </div>
      {normalizedNewBranchName && branchExists ? (
        <div className={styles.errorBanner}>
          <AlertTriangle size={13} />
          <span>Branch "{normalizedNewBranchName}" already exists.</span>
        </div>
      ) : null}
      {normalizedNewBranchName && /\s/.test(normalizedNewBranchName) ? (
        <div className={styles.errorBanner}>
          <AlertTriangle size={13} />
          <span>Branch names cannot contain spaces.</span>
        </div>
      ) : null}
      <div className={styles.commitArea}>
        <textarea
          className={styles.commitInput}
          placeholder="Enter commit message"
          rows={3}
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
        />
        <div className={styles.commitMeta}>
          {readiness?.authorConfigured ? (
            <span className={styles.metaText}>
              Author: {readiness.authorName ?? 'Unknown'} {readiness.authorEmail ? `<${readiness.authorEmail}>` : ''}
            </span>
          ) : (
            <span className={styles.warningText}>
              <AlertTriangle size={12} />
              <span>{readiness?.blockingReason ?? 'Git author is not configured'}</span>
            </span>
          )}
          {readiness?.activeHooks?.length ? (
            <span className={styles.metaText}>Hooks: {readiness.activeHooks.join(', ')}</span>
          ) : null}
          {readiness?.messageHint ? <span className={styles.metaText}>{readiness.messageHint}</span> : null}
        </div>
        <button className={styles.commitBtn} onClick={() => void onCommit()} disabled={commitDisabled}>
          {isMutating ? <Loader2 size={13} className={styles.spinner} /> : <Check size={13} />}
          <span>Commit</span>
        </button>
      </div>
      {surfaceError && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={13} />
          <span>{surfaceError}</span>
        </div>
      )}
      <div className={styles.changes}>
        {staged.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupHeaderRow}>
              <div className={styles.groupHeader}>Staged ({staged.length})</div>
              <button
                className={`${styles.groupDiffBtn} ${diffMode === 'staged-tree' ? styles.groupDiffBtnActive : ''}`}
                onClick={() => {
                  setSelectedKey(null)
                  setDiffMode('staged-tree')
                }}
                type="button"
              >
                View all
              </button>
            </div>
            {staged.map((c) => {
              const Icon = STATUS_ICON[c.status] ?? Circle
              return (
                <div
                  key={c.path}
                  className={`${styles.changeRow} ${selectedKey === changeKey(c.path, c.staged) ? styles.selected : ''}`}
                  onClick={() => {
                    setSelectedKey(changeKey(c.path, c.staged))
                    setDiffMode('selected')
                  }}
                >
                  <Icon size={11} style={{ color: STATUS_COLOR[c.status] }} />
                  <span className={styles.changePath}>{c.path}</span>
                  <span className={styles.changeStatus} style={{ color: STATUS_COLOR[c.status] }}>
                    {c.status.charAt(0).toUpperCase()}
                  </span>
                  <div className={styles.actions}>
                    <button
                      className={styles.actionBtn}
                      onClick={(event) => {
                        event.stopPropagation()
                        void runMutation(() => gitUnstagePaths(tab.projectId, [c.path]))
                      }}
                      disabled={isMutating}
                    >
                      <ArrowDownToLine size={11} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {unstaged.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupHeaderRow}>
              <div className={styles.groupHeader}>Changed ({unstaged.length})</div>
              <button
                className={`${styles.groupDiffBtn} ${diffMode === 'unstaged-tree' ? styles.groupDiffBtnActive : ''}`}
                onClick={() => {
                  setSelectedKey(null)
                  setDiffMode('unstaged-tree')
                }}
                type="button"
              >
                View all
              </button>
            </div>
            {unstaged.map((c) => {
              const Icon = STATUS_ICON[c.status] ?? Circle
              return (
                <div
                  key={c.path}
                  className={`${styles.changeRow} ${selectedKey === changeKey(c.path, c.staged) ? styles.selected : ''}`}
                  onClick={() => {
                    setSelectedKey(changeKey(c.path, c.staged))
                    setDiffMode('selected')
                  }}
                >
                  <Icon size={11} style={{ color: STATUS_COLOR[c.status] }} />
                  <span className={styles.changePath}>{c.path}</span>
                  <span className={styles.changeStatus} style={{ color: STATUS_COLOR[c.status] }}>
                    {c.status.charAt(0).toUpperCase()}
                  </span>
                  <div className={styles.actions}>
                    <button
                      className={styles.actionBtn}
                      onClick={(event) => {
                        event.stopPropagation()
                        void runMutation(() => gitStagePaths(tab.projectId, [c.path]))
                      }}
                      disabled={isMutating}
                    >
                      <ArrowUpToLine size={11} />
                    </button>
                    <button
                      className={styles.actionBtn}
                      onClick={(event) => {
                        event.stopPropagation()
                        void runMutation(() => gitRestorePaths({
                          projectId: tab.projectId,
                          paths: [c.path],
                          staged: false,
                          worktree: true,
                        }))
                      }}
                      disabled={isMutating}
                    >
                      <RotateCcw size={11} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className={styles.diffPanel}>
          <div className={styles.diffHeaderRow}>
            <div className={styles.diffHeader}>
              {diffMode === 'selected'
                ? 'Diff'
                : diffMode === 'staged-tree'
                  ? 'Staged Tree Diff'
                  : 'Unstaged Tree Diff'}
            </div>
            {diffMode !== 'selected' ? (
              <button
                className={styles.groupDiffBtn}
                onClick={() => setDiffMode('selected')}
                type="button"
              >
                Back to file
              </button>
            ) : null}
          </div>
          {diffMode !== 'selected' || selectedChange ? (
            isDiffLoading ? (
              <div className={styles.diffEmpty}>
                <Loader2 size={14} className={styles.spinner} />
                <span>Loading diff...</span>
              </div>
            ) : (
              <pre className={styles.diffContent}>{selectedDiff || 'No diff output for this file.'}</pre>
            )
          ) : (
            <div className={styles.diffEmpty}>Select a change to inspect its diff.</div>
          )}
        </div>
      </div>
    </div>
  )
})

function changeKey(path: string, staged: boolean) {
  return `${staged ? 'staged' : 'unstaged'}:${path}`
}
