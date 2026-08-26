import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalStore } from '@/stores/terminal'

describe('terminal scrollback retention', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: new Map(),
      activeSessionId: new Map(),
      scrollback: new Map(),
      diagnostics: new Map(),
    })
  })

  it('trims oversized scrollback buffers to a bounded window', () => {
    const largeChunk = 'x'.repeat(140 * 1024)

    useTerminalStore.getState().setScrollback('session-1', largeChunk)

    const scrollback = useTerminalStore.getState().scrollback.get('session-1') ?? ''
    expect(scrollback.length).toBe(128 * 1024)
  })
})
