import { memo, useState } from 'react'
import { FolderPlus, GripVertical } from 'lucide-react'
import { projectAdd, projectReorder, toProject } from '@/lib/backend'
import { useProjectsStore } from '@/stores/projects'
import { ProjectSection } from './ProjectSection'
import styles from './ProjectStack.module.css'

export const ProjectStack = memo(function ProjectStack() {
  const projectOrder = useProjectsStore((s) => s.projectOrder)
  const projects = useProjectsStore((s) => s.projects)
  const addProject = useProjectsStore((s) => s.addProject)
  const reorderProjects = useProjectsStore((s) => s.reorderProjects)
  const setActiveProject = useProjectsStore((s) => s.setActiveProject)
  const [newProjectPath, setNewProjectPath] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)

  const onMove = async (projectId: string, direction: -1 | 1) => {
    const index = projectOrder.indexOf(projectId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= projectOrder.length) return
    const nextOrder = [...projectOrder]
    const [moved] = nextOrder.splice(index, 1)
    if (!moved) return
    nextOrder.splice(nextIndex, 0, moved)
    reorderProjects(nextOrder)
    setSurfaceError(null)
    try {
      await projectReorder(nextOrder)
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Failed to reorder projects')
    }
  }

  const onAddProject = async () => {
    const rootPath = newProjectPath.trim()
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
      setSurfaceError(error instanceof Error ? error.message : 'Failed to add project')
    } finally {
      setIsAdding(false)
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
          <button className={styles.addBtn} type="button" onClick={() => void onAddProject()} disabled={isAdding || !newProjectPath.trim()}>
            <FolderPlus size={13} />
            <span>{isAdding ? 'Adding…' : 'Add'}</span>
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
