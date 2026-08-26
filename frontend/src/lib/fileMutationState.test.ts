import { describe, expect, it, vi } from 'vitest'
import { resolveDeleteIntent, runFileMutationWithRefresh } from '@/lib/fileMutationState'

describe('file mutation state', () => {
  it('does not confirm delete without a selected path', () => {
    expect(resolveDeleteIntent(null, 'src/main.ts')).toEqual({
      confirmed: false,
      armedPath: null,
    })
  })

  it('arms the selected path on the first delete action', () => {
    expect(resolveDeleteIntent('src/main.ts', null)).toEqual({
      confirmed: false,
      armedPath: 'src/main.ts',
    })
  })

  it('confirms only when the same selected path is already armed', () => {
    expect(resolveDeleteIntent('src/main.ts', 'src/main.ts')).toEqual({
      confirmed: true,
      armedPath: null,
    })
  })

  it('switches the armed path when selection changes before confirmation', () => {
    expect(resolveDeleteIntent('src/next.ts', 'src/main.ts')).toEqual({
      confirmed: false,
      armedPath: 'src/next.ts',
    })
  })

  it('does not refresh or report refresh errors when the mutation fails', async () => {
    const mutationError = new Error('permission denied')
    const refresh = vi.fn()
    const onMutationSuccess = vi.fn()
    const onMutationError = vi.fn()
    const onRefreshError = vi.fn()

    await expect(runFileMutationWithRefresh({
      mutate: async () => {
        throw mutationError
      },
      refresh,
      onMutationSuccess,
      onMutationError,
      onRefreshError,
    })).resolves.toBe(false)

    expect(refresh).not.toHaveBeenCalled()
    expect(onMutationSuccess).not.toHaveBeenCalled()
    expect(onMutationError).toHaveBeenCalledWith(mutationError)
    expect(onRefreshError).not.toHaveBeenCalled()
  })

  it('reports refresh failure separately after a successful mutation', async () => {
    const refreshError = new Error('watcher unavailable')
    const onMutationSuccess = vi.fn()
    const onMutationError = vi.fn()
    const onRefreshError = vi.fn()

    await expect(runFileMutationWithRefresh({
      mutate: async () => undefined,
      refresh: async () => {
        throw refreshError
      },
      onMutationSuccess,
      onMutationError,
      onRefreshError,
    })).resolves.toBe(true)

    expect(onMutationSuccess).toHaveBeenCalledTimes(1)
    expect(onMutationError).not.toHaveBeenCalled()
    expect(onRefreshError).toHaveBeenCalledWith(refreshError)
  })
})
