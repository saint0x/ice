import { memo, useState, useRef, useEffect, useCallback } from 'react'
import {
  Snowflake, PanelLeft, PanelBottom, MessageSquare,
  Palette, Check, FolderTree, Globe, Terminal
} from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectsStore } from '@/stores/projects'
import { createAndOpenBrowserTab } from '@/lib/browserTabs'
import { resolveWorkbenchProjectId } from '@/lib/projectResolution'
import { createAndFocusTerminalSession } from '@/lib/terminalSessions'
import { useNotificationsStore } from '@/stores/notifications'
import { useThemeStore, THEMES } from '@/stores/theme'
import type { ThemeId } from '@/stores/theme'
import styles from './TitleBar.module.css'

export const TitleBar = memo(function TitleBar() {
  const sidebarOpen = useWorkspaceStore((s) => s.sidebarOpen)
  const setSidebarOpen = useWorkspaceStore((s) => s.setSidebarOpen)
  const bottomDockOpen = useWorkspaceStore((s) => s.bottomDockOpen)
  const setBottomDockOpen = useWorkspaceStore((s) => s.setBottomDockOpen)
  const chatPanelOpen = useWorkspaceStore((s) => s.chatPanelOpen)
  const setChatPanelOpen = useWorkspaceStore((s) => s.setChatPanelOpen)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const projects = useProjectsStore((s) => s.projects)
  const themeId = useThemeStore((s) => s.themeId)
  const setTheme = useThemeStore((s) => s.setTheme)
  const pushNotification = useNotificationsStore((s) => s.pushNotification)
  const pushError = useNotificationsStore((s) => s.pushError)

  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!themeMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [themeMenuOpen])

  const onThemeSelect = (id: ThemeId) => {
    setTheme(id)
    setThemeMenuOpen(false)
  }

  const onOpenFiles = useCallback(() => {
    const resolvedProjectId = resolveWorkbenchProjectId()
    const activeProject = resolvedProjectId ? projects.get(resolvedProjectId) : undefined
    if (!resolvedProjectId || !activeProject) {
      pushNotification({
        title: 'Select a project first',
        message: 'Open or add a project to use Files.',
        level: 'info',
      })
      return
    }
    openTab(activePaneId, 'settings', `${activeProject.name} Files`, resolvedProjectId, { tool: 'files' })
  }, [activePaneId, openTab, projects, pushNotification])

  const onOpenBrowser = useCallback(() => {
    const resolvedProjectId = resolveWorkbenchProjectId()
    if (!resolvedProjectId) {
      pushNotification({
        title: 'Select a project first',
        message: 'Open or add a project to create a browser tab.',
        level: 'info',
      })
      return
    }
    void createAndOpenBrowserTab(resolvedProjectId)
      .catch((error: unknown) => {
        pushError('Browser tab failed', error, 'Failed to create browser tab')
      })
  }, [pushError, pushNotification])

  const onOpenTerminal = useCallback(() => {
    const resolvedProjectId = resolveWorkbenchProjectId()
    if (!resolvedProjectId) {
      pushNotification({
        title: 'Select a project first',
        message: 'Open or add a project to use the terminal.',
        level: 'info',
      })
      return
    }
    void createAndFocusTerminalSession(resolvedProjectId)
      .catch((error: unknown) => {
        pushError('Terminal create failed', error, 'Failed to create terminal')
      })
  }, [pushError, pushNotification])

  return (
    <div className={styles.titleBar} data-tauri-drag-region>
      <div className={styles.left}>
        <button
          className={`${styles.toolBtn} ${sidebarOpen ? styles.toolBtnActive : ''}`}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          <PanelLeft size={14} />
        </button>

        <div className={styles.navDivider} />

        <button className={styles.navBtn} onClick={onOpenFiles} title="Files">
          <FolderTree size={13} />
          <span>Files</span>
        </button>
        <button className={styles.navBtn} onClick={onOpenBrowser} title="Browser">
          <Globe size={13} />
          <span>Browser</span>
        </button>
        <button className={styles.navBtn} onClick={onOpenTerminal} title="Terminal">
          <Terminal size={13} />
          <span>Terminal</span>
        </button>
        <button className={styles.navBtn} onClick={() => setChatPanelOpen(!chatPanelOpen)} title="Thread">
          <MessageSquare size={13} />
          <span>Thread</span>
        </button>
      </div>

      <div className={styles.center} data-tauri-drag-region>
        <Snowflake size={13} className={styles.icon} />
        <span className={styles.title}>Ice</span>
      </div>

      <div className={styles.right}>
        <div className={styles.themeWrapper} ref={menuRef}>
          <button
            className={styles.toolBtn}
            onClick={() => setThemeMenuOpen(!themeMenuOpen)}
            aria-label="Theme"
          >
            <Palette size={14} />
          </button>
          {themeMenuOpen && (
            <div className={styles.themeMenu}>
              {(['Glass', 'Community'] as const).map((group) => (
                <div key={group}>
                  <div className={styles.themeGroup}>{group}</div>
                  {THEMES.filter((t) => t.group === group).map((t) => (
                    <button
                      key={t.id}
                      className={`${styles.themeItem} ${t.id === themeId ? styles.themeItemActive : ''}`}
                      onClick={() => onThemeSelect(t.id)}
                    >
                      <span className={styles.themeLabel}>{t.label}</span>
                      {t.id === themeId && <Check size={12} />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          className={`${styles.toolBtn} ${bottomDockOpen ? styles.toolBtnActive : ''}`}
          onClick={() => setBottomDockOpen(!bottomDockOpen)}
          aria-label="Toggle terminal"
        >
          <PanelBottom size={14} />
        </button>
        <button
          className={`${styles.toolBtn} ${chatPanelOpen ? styles.toolBtnActive : ''}`}
          onClick={() => setChatPanelOpen(!chatPanelOpen)}
          aria-label="Toggle chat"
        >
          <MessageSquare size={14} />
        </button>
      </div>
    </div>
  )
})
