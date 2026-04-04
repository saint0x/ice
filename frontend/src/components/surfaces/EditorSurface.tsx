import { memo } from 'react'
import type { Tab } from '@/types'
import styles from './EditorSurface.module.css'

interface Props {
  tab: Tab
}

export const EditorSurface = memo(function EditorSurface({ tab }: Props) {
  const filePath = (tab.meta?.path as string) ?? tab.title
  const ext = filePath.split('.').pop() ?? ''

  return (
    <div className={styles.surface}>
      <div className={styles.toolbar}>
        <div className={styles.breadcrumb}>
          {filePath.split('/').map((segment, i, arr) => (
            <span key={i}>
              <span className={i === arr.length - 1 ? styles.activeCrumb : styles.crumb}>
                {segment}
              </span>
              {i < arr.length - 1 && <span className={styles.separator}>/</span>}
            </span>
          ))}
        </div>
        <span className={styles.langBadge}>{ext.toUpperCase()}</span>
      </div>
      <div className={styles.editor}>
        <div className={styles.gutter}>
          {Array.from({ length: 40 }, (_, i) => (
            <div key={i} className={styles.lineNum}>{i + 1}</div>
          ))}
        </div>
        <div className={styles.code}>
          <div className={styles.codeLine}>
            <span className={styles.keyword}>import</span> {'{ '}
            <span className={styles.ident}>memo</span>
            {' }'} <span className={styles.keyword}>from</span>{' '}
            <span className={styles.string}>'react'</span>
          </div>
          <div className={styles.codeLine}>
            <span className={styles.keyword}>import</span> {'{ '}
            <span className={styles.ident}>useCallback</span>
            {' }'} <span className={styles.keyword}>from</span>{' '}
            <span className={styles.string}>'react'</span>
          </div>
          <div className={styles.codeLine} />
          <div className={styles.codeLine}>
            <span className={styles.keyword}>interface</span>{' '}
            <span className={styles.type}>Props</span> {'{'}
          </div>
          <div className={styles.codeLine}>
            {'  '}<span className={styles.ident}>name</span>
            {': '}<span className={styles.type}>string</span>
          </div>
          <div className={styles.codeLine}>
            {'  '}<span className={styles.ident}>value</span>
            {': '}<span className={styles.type}>number</span>
          </div>
          <div className={styles.codeLine}>{'}'}</div>
          <div className={styles.codeLine} />
          <div className={styles.codeLine}>
            <span className={styles.keyword}>export</span>{' '}
            <span className={styles.keyword}>const</span>{' '}
            <span className={styles.func}>{tab.title.replace(/\.\w+$/, '')}</span>
            {' = '}
            <span className={styles.func}>memo</span>{'('}
            <span className={styles.keyword}>function</span>{' '}
            <span className={styles.func}>{tab.title.replace(/\.\w+$/, '')}</span>
            {'({ '}
            <span className={styles.ident}>name</span>
            {', '}
            <span className={styles.ident}>value</span>
            {' }: '}
            <span className={styles.type}>Props</span>
            {') {'}
          </div>
          <div className={styles.codeLine}>
            {'  '}<span className={styles.keyword}>return</span> {'('}
          </div>
          <div className={styles.codeLine}>
            {'    '}<span className={styles.tag}>{'<div'}</span>{' '}
            <span className={styles.attr}>className</span>{'='}
            <span className={styles.string}>{'"container"'}</span>
            <span className={styles.tag}>{'>'}</span>
          </div>
          <div className={styles.codeLine}>
            {'      '}<span className={styles.tag}>{'<span>'}</span>
            {'{name}'}
            <span className={styles.tag}>{'</span>'}</span>
          </div>
          <div className={styles.codeLine}>
            {'    '}<span className={styles.tag}>{'</div>'}</span>
          </div>
          <div className={styles.codeLine}>{'  )'}</div>
          <div className={styles.codeLine}>{'})'}</div>
          {Array.from({ length: 25 }, (_, i) => (
            <div key={i} className={styles.codeLine} />
          ))}
        </div>
      </div>
    </div>
  )
})
