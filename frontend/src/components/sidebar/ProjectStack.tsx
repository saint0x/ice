import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { FolderPlus, FolderSearch } from 'lucide-react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { projectAdd, projectReorder, toProject } from '@/lib/backend'
import { useNotificationsStore } from '@/stores/notifications'
import { useProjectsStore } from '@/stores/projects'
import { ProjectSection } from './ProjectSection'
import styles from './ProjectStack.module.css'

export const ProjectStack = memo(function ProjectStack() {
  const projectOrder = useProjectsStore((s) => s.projectOrder)
  const projects = useProjectsStore((s) => s.projects)
  const addProject = useProjectsStore((s) => s.addProject)
  const reorderProjects = useProjectsStore((s) => s.reorderProjects)
  const setActiveProject = useProjectsStore((s) => s.setActiveProject)
  const pushError = useNotificationsStore((s) => s.pushError)
  const [newProjectPath, setNewProjectPath] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null)
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null)
  const [suppressProjectClickId, setSuppressProjectClickId] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLDivElement>())
  const pointerDragRef = useRef<{
    projectId: string
    startY: number
    hasMoved: boolean
  } | null>(null)

  const persistProjectOrder = async (nextOrder: string[]) => {
    const previousOrder = [...projectOrder]
    reorderProjects(nextOrder)
    setSurfaceError(null)
    try {
      await projectReorder(nextOrder)
    } catch (error) {
      reorderProjects(previousOrder)
      const message = error instanceof Error ? error.message : 'Failed to reorder projects'
      setSurfaceError(message)
      pushError('Project reorder failed', error, message)
    }
  }

  useEffect(() => {
    if (!suppressProjectClickId) return
    const timeout = window.setTimeout(() => {
      setSuppressProjectClickId((current) => (current === suppressProjectClickId ? null : current))
    }, 140)
    return () => window.clearTimeout(timeout)
  }, [suppressProjectClickId])

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = pointerDragRef.current
      if (!drag) return
      if (!drag.hasMoved && Math.abs(event.clientY - drag.startY) < 6) {
        return
      }
      if (!drag.hasMoved) {
        drag.hasMoved = true
        setDraggedProjectId(drag.projectId)
        setSuppressProjectClickId(drag.projectId)
      }
      setDropIndicatorIndex(getDropIndicatorIndex(projectOrder, itemRefs.current, event.clientY))
    }

    const finishDrag = () => {
      const drag = pointerDragRef.current
      pointerDragRef.current = null
      if (!drag) return
      const nextIndex = dropIndicatorIndex
      setDraggedProjectId(null)
      setDropIndicatorIndex(null)
      if (!drag.hasMoved || nextIndex == null) {
        return
      }
      const nextOrder = reorderProjectIds(projectOrder, drag.projectId, nextIndex)
      if (nextOrder === projectOrder) {
        return
      }
      void persistProjectOrder(nextOrder)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
    }
  }, [dropIndicatorIndex, projectOrder])

  const onProjectPointerDown = (projectId: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    pointerDragRef.current = {
      projectId,
      startY: event.clientY,
      hasMoved: false,
    }
    setDropIndicatorIndex(projectOrder.indexOf(projectId))
  }

  const addProjectAtPath = async (rootPath: string) => {
    if (!rootPath || isAdding) return
    setIsAdding(true)
    setSurfaceError(null)
    try {
      const created = await projectAdd(rootPath, true)
      const mapped = toProject(created)
      addProject(mapped)
      setActiveProject(mapped.id)
      setNewProjectPath('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add project'
      setSurfaceError(message)
      pushError('Project add failed', error, message)
    } finally {
      setIsAdding(false)
    }
  }

  const onAddProject = async () => {
    const rootPath = newProjectPath.trim()
    if (!rootPath) {
      await onBrowseFolder()
      return
    }
    await addProjectAtPath(rootPath)
  }

  const onBrowseFolder = async () => {
    if (isAdding) return
    setSurfaceError(null)
    try {
      const selection = await openDialog({
        directory: true,
        multiple: false,
        title: 'Select a project folder',
      })
      if (typeof selection === 'string' && selection.length > 0) {
        await addProjectAtPath(selection)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open folder picker'
      setSurfaceError(message)
      pushError('Folder picker failed', error, message)
    }
  }

  return (
    <div className={styles.stack}>
      <div className={styles.projectControls}>
        <div className={styles.addRow}>
          <input
            className={styles.addInput}
            value={newProjectPath}
            onChange={(event) => setNewProjectPath(event.target.value)}
            placeholder="/absolute/path/to/project"
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void onAddProject()
              }
            }}
          />
          <button
            className={styles.addBtn}
            type="button"
            onClick={() => void onBrowseFolder()}
            disabled={isAdding}
            title="Select a folder to add as a project"
          >
            <FolderSearch size={13} />
            <span>{isAdding ? 'Adding…' : 'Browse'}</span>
          </button>
          <button
            className={styles.addBtn}
            type="button"
            onClick={() => void onAddProject()}
            disabled={isAdding}
            title={newProjectPath.trim() ? 'Add project from the path entered above' : 'Select a folder to add as a project'}
          >
            <FolderPlus size={13} />
            <span>{newProjectPath.trim() ? 'Add' : 'Select Folder'}</span>
          </button>
        </div>
        {surfaceError ? <div className={styles.errorBanner}>{surfaceError}</div> : null}
      </div>
      {projectOrder.map((id) => {
        const project = projects.get(id)
        if (!project) return null
        const itemIndex = projectOrder.indexOf(id)
        return (
          <div
            key={id}
            className={`${styles.projectItem} ${draggedProjectId === id ? styles.projectItemDragging : ''}`}
            ref={(node) => {
              if (node) itemRefs.current.set(id, node)
              else itemRefs.current.delete(id)
            }}
          >
            {dropIndicatorIndex === itemIndex ? <div className={styles.dropIndicator} /> : null}
            <ProjectSection
              project={project}
              dragging={draggedProjectId === id}
              suppressProjectClick={suppressProjectClickId === id}
              onProjectPointerDown={onProjectPointerDown(id)}
            />
            {dropIndicatorIndex === itemIndex + 1 ? <div className={styles.dropIndicator} /> : null}
          </div>
        )
      })}
    </div>
  )
})

function getDropIndicatorIndex(order: string[], itemRefs: Map<string, HTMLDivElement>, pointerY: number) {
  for (let index = 0; index < order.length; index += 1) {
    const projectId = order[index]
    if (!projectId) continue
    const item = itemRefs.get(projectId)
    if (!item) continue
    const rect = item.getBoundingClientRect()
    if (pointerY < rect.top + rect.height / 2) {
      return index
    }
  }
  return order.length
}

function reorderProjectIds(order: string[], draggedProjectId: string, targetIndex: number) {
  const sourceIndex = order.indexOf(draggedProjectId)
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex > order.length) {
    return order
  }
  const nextOrder = [...order]
  const [moved] = nextOrder.splice(sourceIndex, 1)
  if (!moved) {
    return order
  }
  const insertionIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
  if (insertionIndex === sourceIndex) {
    return order
  }
  nextOrder.splice(insertionIndex, 0, moved)
  return nextOrder
}
