import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileCode2, Loader2, Save, Search, ChevronUp, ChevronDown, Replace, X, RefreshCcw } from 'lucide-react'
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
  const setConflict = useEditorStore((state) => state.setConflict)
  const updateConflictMergeDraft = useEditorStore((state) => state.updateConflictMergeDraft)
  const reloadFromDisk = useEditorStore((state) => state.reloadFromDisk)
  const updateTab = useWorkspaceStore((state) => state.updateTab)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)

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
          conflict: undefined,
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
  const matches = useMemo(
    () => findMatches(document?.content ?? '', searchQuery),
    [document?.content, searchQuery],
  )
  const boundedMatchIndex = matches.length > 0 ? Math.min(activeMatchIndex, matches.length - 1) : 0
  const activeMatch = matches.length > 0 ? matches[boundedMatchIndex] ?? null : null

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
      const message = error instanceof Error ? error.message : 'Failed to save file'
      if (message.startsWith('save conflict:')) {
        try {
          const latest = await fileRead(tab.projectId, filePath)
          setConflict(
            tab.projectId,
            filePath,
            {
              latestContent: latest.content ?? '',
              latestVersionToken: latest.versionToken ?? undefined,
              latestModifiedAtMs: latest.modifiedAtMs ?? undefined,
              latestEncoding: latest.encoding ?? undefined,
              latestHasBom: latest.hasBom,
              mergeDraft: buildMergedDraft(document.content, latest.content ?? ''),
            },
            message,
          )
        } catch (refreshError) {
          setError(
            tab.projectId,
            filePath,
            refreshError instanceof Error ? refreshError.message : message,
          )
        }
        return
      }
      setError(tab.projectId, filePath, message)
    }
  }

  const onReloadFromDisk = () => {
    if (!document?.conflict) return
    reloadFromDisk(tab.projectId, filePath, {
      projectId: tab.projectId,
      path: filePath,
      content: document.conflict.latestContent,
      isBinary: false,
      encoding: document.conflict.latestEncoding,
      hasBom: document.conflict.latestHasBom,
      modifiedAtMs: document.conflict.latestModifiedAtMs,
      versionToken: document.conflict.latestVersionToken,
      error: undefined,
    })
    updateTab(tab.id, { dirty: false })
  }

  const onOverwriteDisk = async () => {
    if (!document || document.isBinary || document.isSaving) return
    setSaving(tab.projectId, filePath, true)
    try {
      await fileWriteText({
        projectId: tab.projectId,
        path: filePath,
        content: document.content,
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
      setError(tab.projectId, filePath, error instanceof Error ? error.message : 'Failed to overwrite file')
    }
  }

  const onUseMergedDraft = () => {
    if (!document?.conflict) return
    updateContent(tab.projectId, filePath, document.conflict.mergeDraft ?? document.content)
  }

  const onSaveMergedDraft = async () => {
    if (!document?.conflict) return
    updateContent(tab.projectId, filePath, document.conflict.mergeDraft ?? document.content)
    await onOverwriteDisk()
  }

  const focusMatch = (nextIndex: number) => {
    if (!textareaRef.current || matches.length === 0) return
    const bounded = ((nextIndex % matches.length) + matches.length) % matches.length
    const match = matches[bounded]
    if (!match) return
    textareaRef.current.focus()
    textareaRef.current.setSelectionRange(match.start, match.end)
    setActiveMatchIndex(bounded)
  }

  const onReplaceCurrent = () => {
    if (!document || !activeMatch) return
    const nextContent = `${document.content.slice(0, activeMatch.start)}${replaceQuery}${document.content.slice(activeMatch.end)}`
    updateContent(tab.projectId, filePath, nextContent)
    queueMicrotask(() => {
      const nextMatches = findMatches(nextContent, searchQuery)
      if (nextMatches.length > 0) {
        focusMatch(Math.min(activeMatchIndex, nextMatches.length - 1))
      }
    })
  }

  const onReplaceAll = () => {
    if (!document || !searchQuery) return
    updateContent(tab.projectId, filePath, replaceAll(document.content, searchQuery, replaceQuery))
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
            className={styles.findBtn}
            onClick={() => setFindOpen((value) => !value)}
            type="button"
          >
            <Search size={12} />
            <span>Find</span>
          </button>
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
      {findOpen && !document?.isBinary && !document?.isLoading && document ? (
        <div className={styles.findBar}>
          <div className={styles.findGroup}>
            <Search size={12} />
            <input
              className={styles.findInput}
              placeholder="Find in file"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
                setActiveMatchIndex(0)
              }}
              spellCheck={false}
            />
            <span className={styles.findCount}>
              {matches.length === 0 ? '0 results' : `${boundedMatchIndex + 1} of ${matches.length}`}
            </span>
            <button className={styles.findAction} type="button" onClick={() => focusMatch(activeMatchIndex - 1)} disabled={matches.length === 0}>
              <ChevronUp size={12} />
            </button>
            <button className={styles.findAction} type="button" onClick={() => focusMatch(activeMatchIndex + 1)} disabled={matches.length === 0}>
              <ChevronDown size={12} />
            </button>
          </div>
          <div className={styles.findGroup}>
            <Replace size={12} />
            <input
              className={styles.findInput}
              placeholder="Replace"
              value={replaceQuery}
              onChange={(event) => setReplaceQuery(event.target.value)}
              spellCheck={false}
            />
            <button className={styles.findActionWide} type="button" onClick={onReplaceCurrent} disabled={!activeMatch}>
              Replace
            </button>
            <button className={styles.findActionWide} type="button" onClick={onReplaceAll} disabled={!searchQuery}>
              Replace all
            </button>
            <button className={styles.findAction} type="button" onClick={() => setFindOpen(false)}>
              <X size={12} />
            </button>
          </div>
        </div>
      ) : null}
      {document?.error && (
        <div className={styles.alert}>
          <AlertTriangle size={14} />
          <span>{document.error}</span>
        </div>
      )}
      {document?.conflict ? (
        <div className={styles.conflictPanel}>
          <div className={styles.conflictBar}>
            <div className={styles.conflictCopy}>
              <span className={styles.conflictTitle}>File changed on disk</span>
              <span className={styles.conflictDetail}>
                Your version is stale. Compare the current editor buffer with the latest disk contents, then reload, merge, or overwrite intentionally.
              </span>
            </div>
            <div className={styles.conflictActions}>
              <button className={styles.conflictBtn} type="button" onClick={onReloadFromDisk}>
                <RefreshCcw size={12} />
                <span>Reload disk</span>
              </button>
              <button className={styles.conflictBtn} type="button" onClick={onUseMergedDraft}>
                <RefreshCcw size={12} />
                <span>Use merged draft</span>
              </button>
              <button className={styles.conflictBtnPrimary} type="button" onClick={() => void onSaveMergedDraft()}>
                <Save size={12} />
                <span>Save merged draft</span>
              </button>
              <button className={styles.conflictBtnPrimary} type="button" onClick={() => void onOverwriteDisk()}>
                <Save size={12} />
                <span>Overwrite disk</span>
              </button>
            </div>
          </div>
          <div className={styles.conflictCompare}>
            <div className={styles.conflictColumn}>
              <div className={styles.conflictColumnTitle}>Editor buffer</div>
              <pre className={styles.conflictCode}>{document.content}</pre>
            </div>
            <div className={styles.conflictColumn}>
              <div className={styles.conflictColumnTitle}>Disk version</div>
              <pre className={styles.conflictCode}>{document.conflict.latestContent}</pre>
            </div>
          </div>
          <div className={styles.mergeEditor}>
            <div className={styles.conflictColumnTitle}>Merged draft</div>
            <textarea
              className={styles.mergeInput}
              value={document.conflict.mergeDraft ?? document.content}
              spellCheck={false}
              onChange={(event) => updateConflictMergeDraft(tab.projectId, filePath, event.target.value)}
            />
          </div>
        </div>
      ) : null}
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
            ref={textareaRef}
            className={styles.editorInput}
            value={document.content}
            spellCheck={false}
            onChange={(event) => updateContent(tab.projectId, filePath, event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault()
                void onSave()
              }
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault()
                setFindOpen(true)
              }
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'h') {
                event.preventDefault()
                setFindOpen(true)
              }
              if (event.key === 'Enter' && findOpen && searchQuery) {
                event.preventDefault()
                focusMatch(activeMatchIndex + (event.shiftKey ? -1 : 1))
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

function findMatches(content: string, query: string) {
  if (!query) return [] as Array<{ start: number; end: number }>
  const matches: Array<{ start: number; end: number }> = []
  let fromIndex = 0
  while (fromIndex <= content.length) {
    const index = content.indexOf(query, fromIndex)
    if (index < 0) break
    matches.push({ start: index, end: index + query.length })
    fromIndex = index + Math.max(query.length, 1)
  }
  return matches
}

function replaceAll(content: string, query: string, replacement: string) {
  if (!query) return content
  return content.split(query).join(replacement)
}

function buildMergedDraft(localContent: string, latestContent: string) {
  if (!latestContent) return localContent
  if (localContent === latestContent) return localContent
  return [
    '<<<<<<< Editor Buffer',
    localContent,
    '=======',
    latestContent,
    '>>>>>>> Disk Version',
  ].join('\n')
}
