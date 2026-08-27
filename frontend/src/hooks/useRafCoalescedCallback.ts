import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'

interface RafCoalescedCallback<TArgs extends unknown[]> {
  schedule: (...args: TArgs) => void
  flush: () => void
  cancel: () => void
}

export function useRafCoalescedCallback<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
): RafCoalescedCallback<TArgs> {
  const callbackRef = useRef(callback)
  const frameRef = useRef<number | null>(null)
  const latestArgsRef = useRef<TArgs | null>(null)

  useLayoutEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const cancel = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    latestArgsRef.current = null
  }, [])

  const flush = useCallback(() => {
    const latestArgs = latestArgsRef.current
    if (!latestArgs) return
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    latestArgsRef.current = null
    callbackRef.current(...latestArgs)
  }, [])

  const schedule = useCallback((...args: TArgs) => {
    latestArgsRef.current = args
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      const latestArgs = latestArgsRef.current
      latestArgsRef.current = null
      if (latestArgs) {
        callbackRef.current(...latestArgs)
      }
    })
  }, [])

  useEffect(() => cancel, [cancel])

  return useMemo(() => ({ schedule, flush, cancel }), [cancel, flush, schedule])
}
