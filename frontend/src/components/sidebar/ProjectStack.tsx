import { memo } from 'react'
import { useProjectsStore } from '@/stores/projects'
import { ProjectSection } from './ProjectSection'
import styles from './ProjectStack.module.css'

export const ProjectStack = memo(function ProjectStack() {
  const projectOrder = useProjectsStore((s) => s.projectOrder)
  const projects = useProjectsStore((s) => s.projects)

  return (
    <div className={styles.stack}>
      {projectOrder.map((id) => {
        const project = projects.get(id)
        if (!project) return null
        return <ProjectSection key={id} project={project} />
      })}
    </div>
  )
})
