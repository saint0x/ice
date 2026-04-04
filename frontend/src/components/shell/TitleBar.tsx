import { memo, useState, useRef, useEffect } from 'react'
import {
  Minus, Square, X, Snowflake, PanelLeft, PanelBottom, MessageSquare,
  Palette, Check
} from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace'
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
