import { describe, expect, it } from 'vitest'
import { terminalLineCount, terminalLivePreview } from '@/lib/terminalPreview'

describe('terminal preview helpers', () => {
  it('uses diagnostics lines when scrollback has no visible content', () => {
    expect(terminalLivePreview('', ['ready', 'idle'])).toBe('ready\nidle')
    expect(terminalLineCount('', 7)).toBe(7)
  })

  it('returns the recent bounded scrollback window without splitting the whole buffer', () => {
    const scrollback = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join('\n')

    expect(terminalLivePreview(scrollback, [], 4)).toBe('line-17\nline-18\nline-19\nline-20')
    expect(terminalLineCount(scrollback)).toBe(20)
  })

  it('normalizes carriage returns from terminal output', () => {
    expect(terminalLivePreview('one\r\ntwo\r\nthree', [], 2)).toBe('two\nthree')
    expect(terminalLineCount('one\r\ntwo\r\nthree')).toBe(3)
  })
})
