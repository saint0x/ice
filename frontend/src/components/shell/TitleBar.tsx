import { memo, useState, useRef, useEffect, useCallback } from 'react'
import {
  Minus, Square, X, Snowflake, PanelLeft, PanelBottom, MessageSquare,
  Palette, Check, FolderTree, Globe, Terminal
} from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectsStore } from '@/stores/projects'
import { browserTabCreate, toBrowserTab } from '@/lib/backend'
import { useBrowserStore } from '@/stores/browser'
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
  const upsertBrowserTab = useBrowserStore((s) => s.upsertTab)
  const setActiveBrowserTab = useBrowserStore((s) => s.setActiveTab)
  const activeProjectId = useProjectsStore((s) => s.activeProjectId)
  const activeProject = useProjectsStore((s) => activeProjectId ? s.projects.get(activeProjectId) : undefined)
  const themeId = useThemeStore((s) => s.themeId)
  const setTheme = useThemeStore((s) => s.setTheme)

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
    if (!activeProjectId || !activeProject) return
    openTab(activePaneId, 'editor', `${activeProject.name} — Files`, activeProjectId, {})
  }, [activeProjectId, activeProject, activePaneId, openTab])

  const onOpenBrowser = useCallback(() => {
    if (!activeProjectId || !activeProject) return
    void browserTabCreate(activeProjectId, 'https://localhost:3000').then((tab) => {
      const mapped = toBrowserTab(tab)
      upsertBrowserTab(mapped)
      setActiveBrowserTab(activeProjectId, mapped.id)
      openTab(activePaneId, 'browser', mapped.title, activeProjectId, { tabId: mapped.id, url: mapped.url })
    })
  }, [activePaneId, activeProject, activeProjectId, openTab, setActiveBrowserTab, upsertBrowserTab])

  const onOpenTerminal = useCallback(() => {
    if (!activeProjectId) return
    const state = useWorkspaceStore.getState()
    state.setBottomDockOpen(true)
  }, [activeProjectId])

  return (
    <div className={styles.titleBar} data-tauri-drag-region>
      <div className={styles.left}>
        <div className={styles.trafficLights}>
          <button className={`${styles.trafficBtn} ${styles.close}`} aria-label="Close">
            <X size={8} />
          </button>
          <button className={`${styles.trafficBtn} ${styles.minimize}`} aria-label="Minimize">
            <Minus size={8} />
          </button>
          <button className={`${styles.trafficBtn} ${styles.maximize}`} aria-label="Maximize">
            <Square size={7} />
          </button>
        </div>
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
