import { describe, expect, it, vi } from 'vitest'
import { runBrowserSurfaceAction } from '@/lib/browserSurfaceActions'

describe('runBrowserSurfaceAction', () => {
  it('returns the action value and clears stale surface errors on success', async () => {
    const setSurfaceError = vi.fn()
    const pushError = vi.fn()
    const onSuccess = vi.fn()

    await expect(runBrowserSurfaceAction(Promise.resolve('ok'), {
      title: 'Browser action failed',
      fallbackMessage: 'Action failed',
      setSurfaceError,
      pushError,
      onSuccess,
    })).resolves.toBe('ok')

    expect(setSurfaceError).toHaveBeenCalledWith(null)
    expect(onSuccess).toHaveBeenCalledWith('ok')
    expect(pushError).not.toHaveBeenCalled()
  })

  it('surfaces backend failures without rethrowing an unhandled rejection', async () => {
    const error = new Error('renderer unavailable')
    const setSurfaceError = vi.fn()
    const pushError = vi.fn()

    await expect(runBrowserSurfaceAction(Promise.reject(error), {
      title: 'Browser action failed',
      fallbackMessage: 'Action failed',
      setSurfaceError,
      pushError,
    })).resolves.toBeNull()

    expect(setSurfaceError).toHaveBeenCalledWith('renderer unavailable')
    expect(pushError).toHaveBeenCalledWith('Browser action failed', error, 'renderer unavailable')
  })
})
