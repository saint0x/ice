interface GitBranchMutationInput<TSummary, TBranch> {
  mutate: () => Promise<TSummary>
  refreshBranches: () => Promise<TBranch[]>
  onMutationSuccess: (summary: TSummary) => void
  onBranchRefreshSuccess: (branches: TBranch[]) => void
  onBranchRefreshError: (error: unknown) => void
}

export async function runGitBranchMutationWithRefresh<TSummary, TBranch>(
  input: GitBranchMutationInput<TSummary, TBranch>,
) {
  const summary = await input.mutate()
  input.onMutationSuccess(summary)

  try {
    const branches = await input.refreshBranches()
    input.onBranchRefreshSuccess(branches)
  } catch (error) {
    input.onBranchRefreshError(error)
  }

  return summary
}
