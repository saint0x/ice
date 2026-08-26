import { describe, expect, it, vi } from 'vitest'
import { editMenuCommandForId, registerMenuEventListener } from '@/hooks/useMenuEvents'

describe('native menu edit command mapping', () => {
  it('maps edit menu ids to executable app commands', () => {
    expect(editMenuCommandForId('edit.undo')).toBe('undo')
    expect(editMenuCommandForId('edit.redo')).toBe('redo')
    expect(editMenuCommandForId('edit.cut')).toBe('cut')
    expect(editMenuCommandForId('edit.copy')).toBe('copy')
    expect(editMenuCommandForId('edit.paste')).toBe('paste')
    expect(editMenuCommandForId('edit.select_all')).toBe('selectAll')
  })

  it('rejects unknown menu ids instead of manufacturing commands', () => {
    expect(editMenuCommandForId('edit.selectall')).toBeNull()
    expect(editMenuCommandForId('edit.format_document')).toBeNull()
  })
})

describe('native menu listener registration', () => {
  it('stores the native menu unlisten callback when registration succeeds', async () => {
    const unlisten = vi.fn()
    const listenMenu = vi.fn().mockResolvedValue(unlisten)
    const setUnlisten = vi.fn()
    const pushError = vi.fn()
    const handler = vi.fn()

    registerMenuEventListener({
      listenMenu,
      handler,
      setUnlisten,
      pushError,
    })
    await Promise.resolve()

    expect(listenMenu).toHaveBeenCalledWith(handler)
    expect(setUnlisten).toHaveBeenCalledWith(unlisten)
    expect(pushError).not.toHaveBeenCalled()
  })

  it('reports native menu listener registration failures', async () => {
    const error = new Error('menu bridge unavailable')
    const listenMenu = vi.fn().mockRejectedValue(error)
    const setUnlisten = vi.fn()
    const pushError = vi.fn()

    registerMenuEventListener({
      listenMenu,
      handler: vi.fn(),
      setUnlisten,
      pushError,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(setUnlisten).not.toHaveBeenCalled()
    expect(pushError).toHaveBeenCalledWith(
      'Native menu listener failed',
      error,
      'Failed to connect native menu commands',
    )
  })

  it('immediately unlistens when registration resolves after cancellation', async () => {
    const unlisten = vi.fn()
    const listenMenu = vi.fn().mockResolvedValue(unlisten)
    const setUnlisten = vi.fn()
    const pushError = vi.fn()

    registerMenuEventListener({
      listenMenu,
      handler: vi.fn(),
      setUnlisten,
      isCancelled: () => true,
      pushError,
    })
    await Promise.resolve()

    expect(unlisten).toHaveBeenCalled()
    expect(setUnlisten).not.toHaveBeenCalled()
    expect(pushError).not.toHaveBeenCalled()
  })

  it('suppresses native menu listener failures after cancellation', async () => {
    const listenMenu = vi.fn().mockRejectedValue(new Error('window gone'))
    const setUnlisten = vi.fn()
    const pushError = vi.fn()

    registerMenuEventListener({
      listenMenu,
      handler: vi.fn(),
      setUnlisten,
      isCancelled: () => true,
      pushError,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(setUnlisten).not.toHaveBeenCalled()
    expect(pushError).not.toHaveBeenCalled()
  })
})
