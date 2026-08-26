export interface SurfaceErrorSourceRef {
  current: string | null
}

export function setSourcedSurfaceError(
  sourceRef: SurfaceErrorSourceRef,
  setSurfaceError: (message: string | null) => void,
  source: string,
  message: string,
): void {
  sourceRef.current = source
  setSurfaceError(message)
}

export function setUnsourcedSurfaceError(
  sourceRef: SurfaceErrorSourceRef,
  setSurfaceError: (message: string | null) => void,
  message: string | null,
): void {
  sourceRef.current = null
  setSurfaceError(message)
}

export function clearSourcedSurfaceError(
  sourceRef: SurfaceErrorSourceRef,
  setSurfaceError: (message: string | null) => void,
  source: string,
): void {
  if (sourceRef.current !== source) return
  sourceRef.current = null
  setSurfaceError(null)
}
