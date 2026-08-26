import { describe, expect, it } from 'vitest'
import { describeCodexError, describeError } from '@/lib/errors'

describe('error formatting', () => {
  it('preserves string errors from Tauri invoke failures', () => {
    expect(describeError('backend unavailable', 'fallback')).toBe('backend unavailable')
  })

  it('uses object message fields when present', () => {
    expect(describeError({ message: 'project missing' }, 'fallback')).toBe('project missing')
  })

  it('builds descriptive Codex operation errors with context', () => {
    expect(
      describeCodexError('Failed to send Codex prompt', 'channel dropped', {
        projectName: 'ice',
        threadTitle: 'Bugfix Thread',
      }),
    ).toBe('Failed to send Codex prompt in ice / Bugfix Thread. channel dropped')
  })
})
