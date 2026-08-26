import { describe, expect, it, vi } from 'vitest'
import { registerBackendEventListener, startProjectWatchForActiveProject } from '@/hooks/useBackendIntegration'

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

describe('active project watch startup', () => {
  it('starts and records the active project watcher', async () => {
    const watchedProjectRef = { current: null as string | null }
    const projectWatchStart = vi.fn().mockResolvedValue(undefined)
    const projectWatchStop = vi.fn().mockResolvedValue(undefined)

    await startProjectWatchForActiveProject({
      projectId: 'project-a',
      watchedProjectRef,
      projectWatchStart,
      projectWatchStop,
      isCancelled: () => false,
    })

    expect(projectWatchStart).toHaveBeenCalledWith('project-a')
    expect(projectWatchStop).not.toHaveBeenCalled()
    expect(watchedProjectRef.current).toBe('project-a')
  })

  it('does not restart a watcher that is already active', async () => {
    const watchedProjectRef = { current: 'project-a' }
    const projectWatchStart = vi.fn().mockResolvedValue(undefined)
    const projectWatchStop = vi.fn().mockResolvedValue(undefined)

    await startProjectWatchForActiveProject({
      projectId: 'project-a',
      watchedProjectRef,
      projectWatchStart,
      projectWatchStop,
      isCancelled: () => false,
    })

    expect(projectWatchStart).not.toHaveBeenCalled()
    expect(projectWatchStop).not.toHaveBeenCalled()
    expect(watchedProjectRef.current).toBe('project-a')
  })

  it('stops a watcher that starts after project activation was cancelled', async () => {
    const watchedProjectRef = { current: null as string | null }
    let cancelled = false
    const projectWatchStart = vi.fn().mockImplementation(async () => {
      cancelled = true
    })
    const projectWatchStop = vi.fn().mockResolvedValue(undefined)

    await startProjectWatchForActiveProject({
      projectId: 'project-a',
      watchedProjectRef,
      projectWatchStart,
      projectWatchStop,
      isCancelled: () => cancelled,
    })

    expect(projectWatchStart).toHaveBeenCalledWith('project-a')
    expect(projectWatchStop).toHaveBeenCalledWith('project-a')
    expect(watchedProjectRef.current).toBeNull()
  })
})
