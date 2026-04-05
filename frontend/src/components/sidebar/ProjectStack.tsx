import { memo, useState } from 'react'
import { FolderPlus, FolderSearch, GripVertical } from 'lucide-react'
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

  const onMove = async (projectId: string, direction: -1 | 1) => {
    const index = projectOrder.indexOf(projectId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= projectOrder.length) return
    const previousOrder = [...projectOrder]
    const nextOrder = [...projectOrder]
    const [moved] = nextOrder.splice(index, 1)
    if (!moved) return
    nextOrder.splice(nextIndex, 0, moved)
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
    if (!rootPath) return
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
            disabled={isAdding || !newProjectPath.trim()}
            title="Add project from the path entered above"
          >
            <FolderPlus size={13} />
            <span>Add</span>
          </button>
        </div>
        {surfaceError ? <div className={styles.errorBanner}>{surfaceError}</div> : null}
      </div>
      {projectOrder.map((id) => {
        const project = projects.get(id)
        if (!project) return null
        const index = projectOrder.indexOf(id)
        return (
          <div key={id} className={styles.projectCard}>
            <div className={styles.reorderRail}>
              <div className={styles.reorderHandle}>
                <GripVertical size={12} />
              </div>
              <button
                className={styles.reorderBtn}
                type="button"
                onClick={() => void onMove(id, -1)}
                disabled={index === 0}
              >
                Up
              </button>
              <button
                className={styles.reorderBtn}
                type="button"
                onClick={() => void onMove(id, 1)}
                disabled={index === projectOrder.length - 1}
              >
                Down
              </button>
            </div>
            <ProjectSection project={project} />
          </div>
        )
      })}
    </div>
  )
})
