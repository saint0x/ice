import { memo, useCallback, useRef } from 'react'
import type { PaneLayout } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace'
import { Pane } from './Pane'
import styles from './PaneGrid.module.css'

interface PaneRendererProps {
  layout: PaneLayout
}

const SplitHandle = memo(function SplitHandle({
  splitId,
  direction,
}: {
  splitId: string
  direction: 'horizontal' | 'vertical'
}) {
  const updateSplitRatio = useWorkspaceStore((s) => s.updateSplitRatio)
  const ref = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startPos: number; startRatio: number; parentSize: number } | null>(null)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const parent = ref.current?.parentElement
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      const parentSize = direction === 'horizontal' ? rect.width : rect.height
      const store = useWorkspaceStore.getState()

      let startRatio = 0.5
      function findRatio(layout: PaneLayout): number | null {
        if (layout.type === 'split') {
          if (layout.id === splitId) return layout.ratio
          for (const child of layout.children) {
            const r = findRatio(child)
            if (r !== null) return r
          }
        }
        return null
      }
      startRatio = findRatio(store.layout) ?? 0.5

      dragRef.current = {
        startPos: direction === 'horizontal' ? e.clientX : e.clientY,
        startRatio,
        parentSize,
      }

      const onMove = (e: MouseEvent) => {
        if (!dragRef.current) return
        const pos = direction === 'horizontal' ? e.clientX : e.clientY
        const delta = pos - dragRef.current.startPos
        const ratioDelta = delta / dragRef.current.parentSize
        updateSplitRatio(splitId, dragRef.current.startRatio + ratioDelta)
      }
      const onUp = () => {
        dragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [splitId, direction, updateSplitRatio]
  )

  return (
    <div
      ref={ref}
      className={`${styles.splitHandle} ${direction === 'horizontal' ? styles.horizontal : styles.vertical}`}
      onMouseDown={onMouseDown}
    />
  )
})

const PaneRenderer = memo(function PaneRenderer({ layout }: PaneRendererProps) {
  if (layout.type === 'leaf') {
    return <Pane pane={layout} />
  }

  const { direction, children, ratio, id } = layout
  const isHorizontal = direction === 'horizontal'
  const first = children[0]
  const second = children[1]
  if (!first || !second) return null

  return (
    <div
      className={styles.split}
      style={{ flexDirection: isHorizontal ? 'row' : 'column' }}
    >
      <div style={{ flex: `${ratio} 1 0%`, minWidth: 80, minHeight: 100, overflow: 'hidden' }}>
        <PaneRenderer layout={first} />
      </div>
      <SplitHandle splitId={id} direction={direction} />
      <div style={{ flex: `${1 - ratio} 1 0%`, minWidth: 80, minHeight: 100, overflow: 'hidden' }}>
        <PaneRenderer layout={second} />
      </div>
    </div>
  )
})

export const PaneGrid = memo(function PaneGrid() {
  const layout = useWorkspaceStore((s) => s.layout)

  return (
    <div className={styles.grid}>
      <PaneRenderer layout={layout} />
    </div>
  )
})
