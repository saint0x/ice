import { memo, useCallback, useRef } from 'react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useRafCoalescedCallback } from '@/hooks/useRafCoalescedCallback'
import { ProjectStack } from './ProjectStack'
import styles from './Sidebar.module.css'

export const Sidebar = memo(function Sidebar() {
  const open = useWorkspaceStore((s) => s.sidebarOpen)
  const width = useWorkspaceStore((s) => s.sidebarWidth)
  const setWidth = useWorkspaceStore((s) => s.setSidebarWidth)
  const resizeWidth = useRafCoalescedCallback((nextWidth: number) => setWidth(nextWidth))
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      resizeRef.current = { startX: e.clientX, startW: width }
      const onMove = (e: MouseEvent) => {
        if (!resizeRef.current) return
        const delta = e.clientX - resizeRef.current.startX
        resizeWidth.schedule(resizeRef.current.startW + delta)
      }
      const onUp = () => {
        resizeWidth.flush()
        resizeRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [resizeWidth, width]
  )

  if (!open) return null

  return (
    <div className={styles.sidebar} style={{ width }}>
      <div className={styles.content}>
        <ProjectStack />
      </div>
      <div className={styles.resizeHandle} onMouseDown={onResizeStart} />
    </div>
  )
})
