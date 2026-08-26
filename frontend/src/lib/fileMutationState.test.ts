import { describe, expect, it } from 'vitest'
import { resolveDeleteIntent } from '@/lib/fileMutationState'

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
})
