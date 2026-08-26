import { describe, expect, it, vi } from 'vitest'
import {
  clearSourcedSurfaceError,
  setSourcedSurfaceError,
  setUnsourcedSurfaceError,
  type SurfaceErrorSourceRef,
} from '@/lib/surfaceErrors'

describe('surfaceErrors', () => {
  it('clears a sourced surface error only after the same source recovers', () => {
    const sourceRef: SurfaceErrorSourceRef = { current: null }
    const setSurfaceError = vi.fn()

    setSourcedSurfaceError(sourceRef, setSurfaceError, 'renderer-bounds', 'bounds failed')
    clearSourcedSurfaceError(sourceRef, setSurfaceError, 'renderer-attach')

    expect(sourceRef.current).toBe('renderer-bounds')
    expect(setSurfaceError).toHaveBeenCalledTimes(1)
    expect(setSurfaceError).toHaveBeenLastCalledWith('bounds failed')

    clearSourcedSurfaceError(sourceRef, setSurfaceError, 'renderer-bounds')

    expect(sourceRef.current).toBeNull()
    expect(setSurfaceError).toHaveBeenLastCalledWith(null)
  })

  it('prevents recovered background work from clearing a newer unsourced action error', () => {
    const sourceRef: SurfaceErrorSourceRef = { current: null }
    const setSurfaceError = vi.fn()

    setSourcedSurfaceError(sourceRef, setSurfaceError, 'renderer-bounds', 'bounds failed')
    setUnsourcedSurfaceError(sourceRef, setSurfaceError, 'navigation failed')
    clearSourcedSurfaceError(sourceRef, setSurfaceError, 'renderer-bounds')

    expect(sourceRef.current).toBeNull()
    expect(setSurfaceError).toHaveBeenCalledTimes(2)
    expect(setSurfaceError).toHaveBeenLastCalledWith('navigation failed')
  })
})
