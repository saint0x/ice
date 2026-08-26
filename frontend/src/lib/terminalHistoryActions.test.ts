import { describe, expect, it, vi } from 'vitest'
import { copyTerminalHistory } from '@/lib/terminalHistoryActions'

describe('copyTerminalHistory', () => {
  it('does nothing without an active session', async () => {
    const readScrollback = vi.fn()
    const writeClipboard = vi.fn()
    const setSurfaceError = vi.fn()
    const pushError = vi.fn()

    await expect(copyTerminalHistory({
      sessionId: null,
      readScrollback,
      writeClipboard,
      setSurfaceError,
      pushError,
    })).resolves.toBe(false)

    expect(readScrollback).not.toHaveBeenCalled()
    expect(writeClipboard).not.toHaveBeenCalled()
    expect(setSurfaceError).not.toHaveBeenCalled()
    expect(pushError).not.toHaveBeenCalled()
  })

  it('copies forced scrollback and clears stale surface errors on success', async () => {
    const readScrollback = vi.fn().mockResolvedValue('line 1\nline 2\n')
    const writeClipboard = vi.fn().mockResolvedValue(undefined)
    const setSurfaceError = vi.fn()
    const pushError = vi.fn()

    await expect(copyTerminalHistory({
      sessionId: 'terminal-1',
      readScrollback,
      writeClipboard,
      setSurfaceError,
      pushError,
    })).resolves.toBe(true)

    expect(readScrollback).toHaveBeenCalledWith('terminal-1')
    expect(writeClipboard).toHaveBeenCalledWith('line 1\nline 2\n')
    expect(setSurfaceError).toHaveBeenCalledWith(null)
    expect(pushError).not.toHaveBeenCalled()
  })

  it('surfaces clipboard failures without throwing unhandled errors', async () => {
    const error = new Error('clipboard denied')
    const readScrollback = vi.fn().mockResolvedValue('line 1\n')
    const writeClipboard = vi.fn().mockRejectedValue(error)
    const setSurfaceError = vi.fn()
    const pushError = vi.fn()

    await expect(copyTerminalHistory({
      sessionId: 'terminal-1',
      readScrollback,
      writeClipboard,
      setSurfaceError,
      pushError,
    })).resolves.toBe(false)

    expect(setSurfaceError).toHaveBeenCalledWith('clipboard denied')
    expect(pushError).toHaveBeenCalledWith('Terminal history copy failed', error, 'clipboard denied')
  })
})
