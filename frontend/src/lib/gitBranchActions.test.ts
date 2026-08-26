import { describe, expect, it, vi } from 'vitest'
import { runGitBranchMutationWithRefresh } from '@/lib/gitBranchActions'

describe('runGitBranchMutationWithRefresh', () => {
  it('applies mutation summary before refreshing branch picker state', async () => {
    const order: string[] = []
    const summary = { branch: 'feature/search' }
    const branches = [{ name: 'feature/search', current: true }]
    const onMutationSuccess = vi.fn(() => order.push('summary'))
    const onBranchRefreshSuccess = vi.fn(() => order.push('branches'))
    const onBranchRefreshError = vi.fn()

    await expect(runGitBranchMutationWithRefresh({
      mutate: async () => summary,
      refreshBranches: async () => branches,
      onMutationSuccess,
      onBranchRefreshSuccess,
      onBranchRefreshError,
    })).resolves.toBe(summary)

    expect(onMutationSuccess).toHaveBeenCalledWith(summary)
    expect(onBranchRefreshSuccess).toHaveBeenCalledWith(branches)
    expect(onBranchRefreshError).not.toHaveBeenCalled()
    expect(order).toEqual(['summary', 'branches'])
  })

  it('surfaces branch refresh failures after a successful mutation', async () => {
    const refreshError = new Error('branch list unavailable')
    const summary = { branch: 'main' }
    const onMutationSuccess = vi.fn()
    const onBranchRefreshSuccess = vi.fn()
    const onBranchRefreshError = vi.fn()

    await expect(runGitBranchMutationWithRefresh({
      mutate: async () => summary,
      refreshBranches: async () => {
        throw refreshError
      },
      onMutationSuccess,
      onBranchRefreshSuccess,
      onBranchRefreshError,
    })).resolves.toBe(summary)

    expect(onMutationSuccess).toHaveBeenCalledWith(summary)
    expect(onBranchRefreshSuccess).not.toHaveBeenCalled()
    expect(onBranchRefreshError).toHaveBeenCalledWith(refreshError)
  })

  it('does not refresh branch state when the mutation fails', async () => {
    const mutationError = new Error('checkout blocked')
    const refreshBranches = vi.fn()
    const onMutationSuccess = vi.fn()
    const onBranchRefreshSuccess = vi.fn()
    const onBranchRefreshError = vi.fn()

    await expect(runGitBranchMutationWithRefresh({
      mutate: async () => {
        throw mutationError
      },
      refreshBranches,
      onMutationSuccess,
      onBranchRefreshSuccess,
      onBranchRefreshError,
    })).rejects.toThrow('checkout blocked')

    expect(refreshBranches).not.toHaveBeenCalled()
    expect(onMutationSuccess).not.toHaveBeenCalled()
    expect(onBranchRefreshSuccess).not.toHaveBeenCalled()
    expect(onBranchRefreshError).not.toHaveBeenCalled()
  })
})
