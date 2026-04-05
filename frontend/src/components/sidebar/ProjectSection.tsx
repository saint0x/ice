import { memo, useCallback, useMemo, useState } from 'react'
import {
  FolderOpen, GitBranch, FolderTree, Globe, Terminal, MessageSquare,
  Search, Play, Bug, CheckCircle, ChevronRight, ChevronDown, Trash2
} from 'lucide-react'
import type { Project, SidebarSection } from '@/types'
import { codexThreadCreate, projectRemove, terminalCreate, toCodexThread, toTerminalSession } from '@/lib/backend'
import { useProjectsStore } from '@/stores/projects'
import { useGitStore } from '@/stores/git'
import { useTerminalStore } from '@/stores/terminal'
import { useCodexStore } from '@/stores/codex'
import { useWorkspaceStore } from '@/stores/workspace'
import { FileTree } from './FileTree'
import { BrowserList } from './BrowserList'
import { GitSummary } from './GitSummary'
import { TerminalList } from './TerminalList'
import styles from './ProjectSection.module.css'

interface Props {
  project: Project
}

const SECTION_ROWS: { key: SidebarSection; icon: typeof FolderTree; label: string }[] = [
  { key: 'files', icon: FolderTree, label: 'Project' },
  { key: 'git', icon: GitBranch, label: 'Git' },
  { key: 'browser', icon: Globe, label: 'Browser Tabs' },
  { key: 'terminal', icon: Terminal, label: 'Terminal Tabs' },
]

export const ProjectSection = memo(function ProjectSection({ project }: Props) {
  const activeProjectId = useProjectsStore((s) => s.activeProjectId)
  const setActiveProject = useProjectsStore((s) => s.setActiveProject)
  const removeProject = useProjectsStore((s) => s.removeProject)
  const toggleSection = useProjectsStore((s) => s.toggleSection)
  const toggleProjectCollapsed = useProjectsStore((s) => s.toggleProjectCollapsed)
  const gitChangeCount = useGitStore((s) => s.gitState.get(project.id)?.changes.length ?? 0)
  const sessions = useTerminalStore((s) => s.sessions)
  const allThreads = useCodexStore((s) => s.threads)
  const addThread = useCodexStore((s) => s.addThread)
  const setActiveThread = useCodexStore((s) => s.setActiveThread)
  const upsertSession = useTerminalStore((s) => s.upsertSession)
  const setActiveSession = useTerminalStore((s) => s.setActiveSession)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const setBottomDockOpen = useWorkspaceStore((s) => s.setBottomDockOpen)
  const setChatPanelOpen = useWorkspaceStore((s) => s.setChatPanelOpen)
  const isActive = project.id === activeProjectId
  const [surfaceError, setSurfaceError] = useState<string | null>(null)

  const terminalCount = useMemo(() => {
    let count = 0
    for (const session of sessions.values()) {
      if (session.projectId === project.id) count++
    }
    return count
  }, [sessions, project.id])

  const unreadThreadCount = useMemo(() => {
    let count = 0
    for (const thread of allThreads.values()) {
      if (thread.projectId === project.id && thread.unread) count++
    }
    return count
  }, [allThreads, project.id])

  const onProjectClick = useCallback(() => {
    if (isActive) {
      toggleProjectCollapsed(project.id)
    } else {
      setActiveProject(project.id)
    }
  }, [project.id, isActive, setActiveProject, toggleProjectCollapsed])

  const onSectionClick = useCallback(
    (section: SidebarSection) => {
      setActiveProject(project.id)
      toggleSection(project.id, section)
    },
    [project.id, toggleSection, setActiveProject]
  )

  const onQuickAction = useCallback(
    async (type: 'codex' | 'search' | 'terminal' | 'diagnostics' | 'debug') => {
      setActiveProject(project.id)
      if (type === 'codex') {
        setChatPanelOpen(true)
        void codexThreadCreate(project.id).then((thread) => {
          const mapped = toCodexThread(thread)
          addThread(mapped)
          setActiveThread(project.id, mapped.id)
          openTab(activePaneId, 'codex', mapped.title, project.id, { threadId: mapped.id })
        })
      } else if (type === 'search') {
        openTab(activePaneId, 'settings', `${project.name} Search`, project.id, { tool: 'search' })
      } else if (type === 'diagnostics') {
        openTab(activePaneId, 'settings', `${project.name} Diagnostics`, project.id, { tool: 'diagnostics' })
      } else if (type === 'debug') {
        openTab(activePaneId, 'settings', `${project.name} Debug`, project.id, { tool: 'debug' })
      } else if (type === 'terminal') {
        setBottomDockOpen(true)
        const session = await terminalCreate(project.id)
        const mapped = toTerminalSession(session)
        upsertSession(mapped)
        setActiveSession(project.id, mapped.id)
      }
    },
    [activePaneId, addThread, openTab, project.id, project.name, setActiveProject, setActiveSession, setActiveThread, setBottomDockOpen, setChatPanelOpen, upsertSession]
  )

  const onRemoveProject = useCallback(async () => {
    setSurfaceError(null)
    try {
      await projectRemove(project.id)
      removeProject(project.id)
    } catch (error) {
      setSurfaceError(error instanceof Error ? error.message : 'Failed to remove project')
    }
  }, [project.id, removeProject])

  const getBadge = (section: SidebarSection): string | undefined => {
    if (section === 'git' && gitChangeCount > 0) return String(gitChangeCount)
    if (section === 'terminal' && terminalCount > 0) return String(terminalCount)
    return undefined
  }

  const activeSectionKey = useProjectsStore((s) => {
    const p = s.projects.get(project.id)
    if (!p) return null
    for (const row of SECTION_ROWS) {
      if (p.expandedSections.has(row.key)) return row.key
    }
    return null
  })

  return (
    <div className={`${styles.card} ${isActive ? styles.active : ''}`}>
      {/* Project picker row */}
      <button className={styles.projectRow} onClick={onProjectClick}>
        <FolderOpen size={14} className={styles.projectIcon} />
        <span className={styles.projectName}>{project.name}</span>
        <span className={styles.branchPill}>
          <GitBranch size={10} />
          <span className={styles.branchLabel}>
            {project.branch.length > 18 ? project.branch.slice(0, 18) + '…' : project.branch}
          </span>
        </span>
        {project.collapsed
          ? <ChevronRight size={12} className={styles.collapseIcon} />
          : <ChevronDown size={12} className={styles.collapseIcon} />
        }
      </button>
      {surfaceError ? <div className={styles.inlineError}>{surfaceError}</div> : null}

      {!project.collapsed && (
        <>
          <div className={styles.divider} />

          {/* Section rows */}
          {SECTION_ROWS.map(({ key, icon: Icon, label }) => {
            const selected = activeSectionKey === key && isActive
            const badge = getBadge(key)
            return (
              <button
                key={key}
                className={`${styles.sectionRow} ${selected ? styles.selected : ''}`}
                onClick={() => onSectionClick(key)}
              >
                <Icon size={14} />
                <span className={styles.sectionLabel}>{label}</span>
                {badge && <span className={styles.badge}>{badge}</span>}
              </button>
            )
          })}

          {/* Quick action buttons */}
          <div className={styles.actionRow}>
            <button
              className={styles.actionBtn}
              onClick={() => onQuickAction('codex')}
              title="Codex"
            >
              <MessageSquare size={14} />
              {unreadThreadCount > 0 && <span className={styles.actionDot} />}
            </button>
            <button className={styles.actionBtn} onClick={() => void onQuickAction('search')} title="Search">
              <Search size={14} />
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => onQuickAction('terminal')}
              title="Run"
            >
              <Play size={14} />
            </button>
            <button className={styles.actionBtn} onClick={() => void onQuickAction('diagnostics')} title="Diagnostics">
              <CheckCircle size={14} />
            </button>
            <button className={styles.actionBtn} onClick={() => void onQuickAction('debug')} title="Debug">
              <Bug size={14} />
            </button>
            <button className={styles.actionBtn} onClick={() => void onRemoveProject()} title="Remove Project">
              <Trash2 size={14} />
            </button>
          </div>

          <div className={styles.divider} />

          {/* Expanded section content */}
          {SECTION_ROWS.map(({ key }) => {
            const expanded = project.expandedSections.has(key)
            if (!expanded) return null
            return (
              <div key={key} className={styles.sectionContent}>
                {key === 'files' && <FileTree projectId={project.id} />}
                {key === 'git' && <GitSummary projectId={project.id} />}
                {key === 'terminal' && <TerminalList projectId={project.id} />}
                {key === 'browser' && <BrowserList projectId={project.id} />}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
})
