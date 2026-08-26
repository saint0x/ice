import { describe, expect, it, vi } from 'vitest'
import { registerBackendEventListener } from '@/hooks/useBackendIntegration'

describe('backend event listener registration', () => {
  it('stores the backend unlisten callback when registration succeeds', async () => {
    const unlisten = vi.fn()
    const listen = vi.fn().mockResolvedValue(unlisten)
    const setUnlisten = vi.fn()
    const pushError = vi.fn()
    const handler = vi.fn()

    registerBackendEventListener({
      label: 'Browser',
      listen,
      handler,
      setUnlisten,
      pushError,
    })
    await Promise.resolve()

    expect(listen).toHaveBeenCalledWith(handler)
    expect(setUnlisten).toHaveBeenCalledWith(unlisten)
    expect(pushError).not.toHaveBeenCalled()
  })

  it('reports listener registration failures instead of leaving silent disconnects', async () => {
    const error = new Error('event bridge unavailable')
    const listen = vi.fn().mockRejectedValue(error)
    const setUnlisten = vi.fn()
    const pushError = vi.fn()

    registerBackendEventListener({
      label: 'Terminal',
      listen,
      handler: vi.fn(),
      setUnlisten,
      pushError,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(setUnlisten).not.toHaveBeenCalled()
    expect(pushError).toHaveBeenCalledWith(
      'Terminal listener failed',
      error,
      'Failed to connect terminal updates',
    )
  })

  it('immediately unlistens when registration resolves after disposal', async () => {
    const unlisten = vi.fn()
    const listen = vi.fn().mockResolvedValue(unlisten)
    const setUnlisten = vi.fn()
    const pushError = vi.fn()

    registerBackendEventListener({
      label: 'Git',
      listen,
      handler: vi.fn(),
      setUnlisten,
      isDisposed: () => true,
      pushError,
    })
    await Promise.resolve()

    expect(unlisten).toHaveBeenCalled()
    expect(setUnlisten).not.toHaveBeenCalled()
    expect(pushError).not.toHaveBeenCalled()
  })

  it('suppresses listener registration failures after disposal', async () => {
    const listen = vi.fn().mockRejectedValue(new Error('window gone'))
    const setUnlisten = vi.fn()
    const pushError = vi.fn()

    registerBackendEventListener({
      label: 'Codex',
      listen,
      handler: vi.fn(),
      setUnlisten,
      isDisposed: () => true,
      pushError,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(setUnlisten).not.toHaveBeenCalled()
    expect(pushError).not.toHaveBeenCalled()
  })
})
