import { memo, useEffect, useMemo } from 'react'
import { AlertTriangle, FileCode2, Loader2, Save } from 'lucide-react'
import type { Tab } from '@/types'
import { fileRead, fileWriteText } from '@/lib/backend'
import { useEditorStore } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'
import styles from './EditorSurface.module.css'

interface Props {
  tab: Tab
}

export const EditorSurface = memo(function EditorSurface({ tab }: Props) {
  const filePath = (tab.meta?.path as string) ?? tab.title
  const documentKey = `${tab.projectId}:${filePath}`
  const document = useEditorStore((state) => state.documents.get(documentKey))
  const setLoading = useEditorStore((state) => state.setLoading)
  const hydrateDocument = useEditorStore((state) => state.hydrateDocument)
  const updateContent = useEditorStore((state) => state.updateContent)
  const markSaved = useEditorStore((state) => state.markSaved)
  const setSaving = useEditorStore((state) => state.setSaving)
  const setError = useEditorStore((state) => state.setError)
  const updateTab = useWorkspaceStore((state) => state.updateTab)

  useEffect(() => {
    let disposed = false
    if (document && !document.error && !document.isLoading) return
    setLoading(tab.projectId, filePath)
    void fileRead(tab.projectId, filePath)
      .then((result) => {
        if (disposed) return
        hydrateDocument({
          projectId: tab.projectId,
          path: filePath,
          content: result.content ?? '',
          isBinary: result.isBinary,
          encoding: result.encoding ?? undefined,
          hasBom: result.hasBom,
          modifiedAtMs: result.modifiedAtMs ?? undefined,
          versionToken: result.versionToken ?? undefined,
          isDirty: false,
          isLoading: false,
          isSaving: false,
        })
        updateTab(tab.id, { dirty: false, title: filePath.split('/').pop() ?? filePath })
      })
      .catch((error: unknown) => {
        if (disposed) return
        setError(tab.projectId, filePath, error instanceof Error ? error.message : 'Failed to read file')
      })
    return () => {
      disposed = true
    }
  }, [document, filePath, hydrateDocument, setError, setLoading, tab.id, tab.projectId, updateTab])

  useEffect(() => {
    updateTab(tab.id, { dirty: document?.isDirty ?? false })
  }, [document?.isDirty, tab.id, updateTab])

  const ext = useMemo(() => filePath.split('.').pop()?.toUpperCase() ?? 'TEXT', [filePath])

  const onSave = async () => {
    if (!document || document.isBinary || document.isSaving) return
    setSaving(tab.projectId, filePath, true)
    try {
      await fileWriteText({
        projectId: tab.projectId,
        path: filePath,
        content: document.content,
        expectedVersionToken: document.versionToken,
        encoding: document.encoding,
        hasBom: document.hasBom,
      })
      const refreshed = await fileRead(tab.projectId, filePath)
      markSaved(tab.projectId, filePath, {
        projectId: tab.projectId,
        path: filePath,
        content: refreshed.content ?? '',
        isBinary: refreshed.isBinary,
        encoding: refreshed.encoding ?? undefined,
        hasBom: refreshed.hasBom,
        modifiedAtMs: refreshed.modifiedAtMs ?? undefined,
        versionToken: refreshed.versionToken ?? undefined,
        error: undefined,
      })
      updateTab(tab.id, { dirty: false })
    } catch (error) {
      setError(
        tab.projectId,
        filePath,
        error instanceof Error ? error.message : 'Failed to save file',
      )
    }
  }

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
        <div className={styles.toolbarMeta}>
          {document?.encoding && <span className={styles.metaBadge}>{document.encoding}</span>}
          <span className={styles.langBadge}>{ext}</span>
          <button
            className={styles.saveBtn}
            onClick={() => void onSave()}
            disabled={!document || document.isBinary || !document.isDirty || document.isSaving}
          >
            {document?.isSaving ? <Loader2 size={12} className={styles.spinner} /> : <Save size={12} />}
            <span>Save</span>
          </button>
        </div>
      </div>
      {document?.error && (
        <div className={styles.alert}>
          <AlertTriangle size={14} />
          <span>{document.error}</span>
        </div>
      )}
      {document?.isBinary ? (
        <div className={styles.binaryState}>
          <FileCode2 size={18} className={styles.binaryIcon} />
          <span className={styles.binaryTitle}>Binary file</span>
          <span className={styles.binaryHint}>
            This file is tracked by the IDE, but it cannot be edited safely in the text surface.
          </span>
        </div>
      ) : document?.isLoading || !document ? (
        <div className={styles.loadingState}>
          <Loader2 size={16} className={styles.spinner} />
          <span>Loading file...</span>
        </div>
      ) : (
        <div className={styles.editorShell}>
          <div className={styles.lineNumbers}>
            {lineNumbersFor(document.content).map((line) => (
              <div key={line} className={styles.lineNum}>{line}</div>
            ))}
          </div>
          <textarea
            className={styles.editorInput}
            value={document.content}
            spellCheck={false}
            onChange={(event) => updateContent(tab.projectId, filePath, event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault()
                void onSave()
              }
            }}
          />
        </div>
      )}
    </div>
  )
})

function lineNumbersFor(content: string) {
  return Array.from({ length: Math.max(content.split('\n').length, 1) }, (_, index) => index + 1)
}
