import { memo, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Lock, Globe } from 'lucide-react'
import type { Tab } from '@/types'
import styles from './BrowserSurface.module.css'

interface Props {
  tab: Tab
}

export const BrowserSurface = memo(function BrowserSurface({ tab }: Props) {
  const [url, setUrl] = useState((tab.meta?.url as string) ?? 'https://example.com')

  return (
    <div className={styles.surface}>
      <div className={styles.toolbar}>
        <div className={styles.navButtons}>
          <button className={styles.navBtn} aria-label="Back"><ArrowLeft size={14} /></button>
          <button className={styles.navBtn} aria-label="Forward"><ArrowRight size={14} /></button>
          <button className={styles.navBtn} aria-label="Reload"><RotateCw size={13} /></button>
        </div>
        <div className={styles.addressBar}>
          <Lock size={11} className={styles.lockIcon} />
          <input
            className={styles.addressInput}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>
      <div className={styles.viewport}>
        <div className={styles.placeholder}>
          <Globe size={32} className={styles.placeholderIcon} />
          <span className={styles.placeholderUrl}>{url}</span>
          <span className={styles.placeholderHint}>Browser rendering via Tauri webview</span>
        </div>
      </div>
    </div>
  )
})
