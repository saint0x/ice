import { describe, expect, it, vi } from 'vitest'
import { runTerminalShortcutAction } from '@/lib/terminalShortcutActions'

describe('runTerminalShortcutAction', () => {
  it('runs success callbacks and returns the command value', async () => {
    const pushError = vi.fn()
    const onSuccess = vi.fn()

    await expect(runTerminalShortcutAction(Promise.resolve('done'), {
      title: 'Terminal command failed',
      fallbackMessage: 'Command failed',
      pushError,
      onSuccess,
    })).resolves.toBe('done')

    expect(onSuccess).toHaveBeenCalledWith('done')
    expect(pushError).not.toHaveBeenCalled()
  })

  it('reports failures without rethrowing unhandled shortcut rejections', async () => {
    const error = new Error('pty closed')
    const pushError = vi.fn()

    await expect(runTerminalShortcutAction(Promise.reject(error), {
      title: 'Terminal command failed',
      fallbackMessage: 'Command failed',
      pushError,
    })).resolves.toBeNull()

    expect(pushError).toHaveBeenCalledWith('Terminal command failed', error, 'pty closed')
  })
})
