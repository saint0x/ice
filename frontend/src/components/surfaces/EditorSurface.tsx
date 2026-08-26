import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileCode2, Loader2, Save, Search, ChevronUp, ChevronDown, Replace, X, RefreshCcw } from 'lucide-react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, type Extension, Annotation, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap } from '@codemirror/view'
import { LanguageDescription, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import type { Tab } from '@/types'
import { fileSyntaxProfile, fileSyntaxTokens, fileWriteText } from '@/lib/backend'
import { ensureEditorDocument } from '@/lib/editorDocuments'
import { useEditorStore } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'
import styles from './EditorSurface.module.css'

interface Props {
  tab: Tab
}

const externalUpdate = Annotation.define<boolean>()
const setSyntaxDecorations = StateEffect.define<BackendSyntaxToken[]>()
const syntaxDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(value, transaction) {
    let next = value.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setSyntaxDecorations)) {
        next = buildSyntaxDecorations(transaction.state, effect.value)
      }
    }
    return next
  },
  provide(field) {
    return EditorView.decorations.from(field)
  },
})

interface BackendSyntaxToken {
  line: number
  start: number
  length: number
  tokenType: string
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
  const touchDocument = useEditorStore((state) => state.touchDocument)
  const updateTab = useWorkspaceStore((state) => state.updateTab)

  const editorRootRef = useRef<HTMLDivElement | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const languageCompartmentRef = useRef(new Compartment())
  const editableCompartmentRef = useRef(new Compartment())
  const documentKeyRef = useRef<string | null>(null)
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const documentContent = document?.content
  const documentIsBinary = document?.isBinary ?? false
  const documentIsLoading = document?.isLoading ?? false
  const documentIsSaving = document?.isSaving ?? false
  const documentSyntaxMode = document?.syntaxMode
  const documentReadFailed = document?.readFailed ?? false

  const [languageLabel, setLanguageLabel] = useState<string | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)

  useEffect(() => {
    let disposed = false
    const existing = useEditorStore.getState().documents.get(documentKey)
    if (existing && !existing.isLoading && !existing.readFailed) {
      touchDocument(tab.projectId, filePath)
      return
    }
    setLoading(tab.projectId, filePath)
    void ensureEditorDocument(tab.projectId, filePath)
      .then((nextDocument) => {
        if (disposed || !nextDocument) return
        hydrateDocument(nextDocument)
        updateTab(tab.id, { dirty: false, title: filePath.split('/').pop() ?? filePath })
      })
    return () => {
      disposed = true
    }
  }, [documentKey, filePath, hydrateDocument, setLoading, tab.id, tab.projectId, touchDocument, updateTab])

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

  const onSave = useCallback(async () => {
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
      const refreshed = await ensureEditorDocument(tab.projectId, filePath, { force: true })
      if (!refreshed) {
        throw new Error('Failed to reload file after save')
      }
      markSaved(tab.projectId, filePath, {
        projectId: tab.projectId,
        path: filePath,
        content: refreshed.content,
        isBinary: refreshed.isBinary,
        sizeBytes: refreshed.sizeBytes,
        encoding: refreshed.encoding,
        hasBom: refreshed.hasBom,
        modifiedAtMs: refreshed.modifiedAtMs,
        versionToken: refreshed.versionToken,
        loadedAt: refreshed.loadedAt,
        lastTouchedAt: refreshed.lastTouchedAt,
        syntaxMode: refreshed.syntaxMode,
        error: undefined,
      })
      updateTab(tab.id, { dirty: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save file'
      if (message.startsWith('save conflict:')) {
        try {
          const latest = await ensureEditorDocument(tab.projectId, filePath, { force: true })
          if (!latest) {
            throw new Error('Failed to reload conflicting file from disk')
          }
          setConflict(
            tab.projectId,
            filePath,
            {
              latestContent: latest.content,
              latestVersionToken: latest.versionToken,
              latestModifiedAtMs: latest.modifiedAtMs,
              latestEncoding: latest.encoding,
              latestHasBom: latest.hasBom,
              mergeDraft: buildMergedDraft(document.content, latest.content),
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
  }, [
    document,
    filePath,
    markSaved,
    setConflict,
    setError,
    setSaving,
    tab.id,
    tab.projectId,
    updateTab,
  ])

  saveRef.current = onSave

  const onReloadFromDisk = () => {
    if (!document?.conflict) return
    const latestContent = document.conflict.latestContent
    reloadFromDisk(tab.projectId, filePath, {
      projectId: tab.projectId,
      path: filePath,
      content: latestContent,
      isBinary: false,
      sizeBytes: new TextEncoder().encode(latestContent).length,
      encoding: document.conflict.latestEncoding,
      hasBom: document.conflict.latestHasBom,
      modifiedAtMs: document.conflict.latestModifiedAtMs,
      versionToken: document.conflict.latestVersionToken,
      loadedAt: Date.now(),
      lastTouchedAt: Date.now(),
      syntaxMode: document.syntaxMode,
      error: undefined,
    })
    updateTab(tab.id, { dirty: false })
  }

  const onOverwriteDisk = async (contentOverride?: string) => {
    if (!document || document.isBinary || document.isSaving) return
    const content = contentOverride ?? document.content
    setSaving(tab.projectId, filePath, true)
    try {
      await fileWriteText({
        projectId: tab.projectId,
        path: filePath,
        content,
        encoding: document.encoding,
        hasBom: document.hasBom,
      })
      const refreshed = await ensureEditorDocument(tab.projectId, filePath, { force: true })
      if (!refreshed) {
        throw new Error('Failed to reload file after overwrite')
      }
      markSaved(tab.projectId, filePath, {
        projectId: tab.projectId,
        path: filePath,
        content: refreshed.content,
        isBinary: refreshed.isBinary,
        sizeBytes: refreshed.sizeBytes,
        encoding: refreshed.encoding,
        hasBom: refreshed.hasBom,
        modifiedAtMs: refreshed.modifiedAtMs,
        versionToken: refreshed.versionToken,
        loadedAt: refreshed.loadedAt,
        lastTouchedAt: refreshed.lastTouchedAt,
        syntaxMode: refreshed.syntaxMode,
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
    const mergeDraft = document.conflict.mergeDraft ?? document.content
    updateContent(tab.projectId, filePath, mergeDraft)
    await onOverwriteDisk(mergeDraft)
  }

  useEffect(() => {
    if (!editorRootRef.current || !document || documentIsBinary || documentIsLoading || documentReadFailed) {
      if (editorViewRef.current) {
        editorViewRef.current.destroy()
        editorViewRef.current = null
        documentKeyRef.current = null
      }
      return
    }

    if (documentKeyRef.current === documentKey && editorViewRef.current) {
      return
    }

    editorViewRef.current?.destroy()

    const languageCompartment = languageCompartmentRef.current
    const editableCompartment = editableCompartmentRef.current
    const editor = new EditorView({
      state: EditorState.create({
        doc: document.content,
        extensions: [
          basicSetup,
          buildEditorTheme(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          syntaxDecorationsField,
          EditorState.tabSize.of(2),
          languageCompartment.of([]),
          editableCompartment.of(EditorView.editable.of(!documentIsSaving)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            if (update.transactions.some((transaction) => transaction.annotation(externalUpdate))) {
              return
            }
            const nextContent = update.state.doc.toString()
            if (nextContent !== useEditorStore.getState().documents.get(documentKey)?.content) {
              updateContent(tab.projectId, filePath, nextContent)
            }
          }),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                void saveRef.current()
                return true
              },
            },
            {
              key: 'Mod-f',
              run: () => {
                setFindOpen(true)
                queueMicrotask(() => {
                  editorViewRef.current?.focus()
                })
                return true
              },
            },
          ]),
        ],
      }),
      parent: editorRootRef.current,
    })

    editorViewRef.current = editor
    documentKeyRef.current = documentKey

    return () => {
      if (editorViewRef.current === editor) {
        editor.destroy()
        editorViewRef.current = null
        documentKeyRef.current = null
      }
    }
  }, [document, documentIsBinary, documentIsLoading, documentIsSaving, documentKey, documentReadFailed, filePath, tab.projectId, updateContent])

  useEffect(() => {
    const editor = editorViewRef.current
    if (!editor || documentContent == null || documentIsBinary || documentIsLoading || documentReadFailed) return
    const currentContent = editor.state.doc.toString()
    if (currentContent === documentContent) return
    editor.dispatch({
      changes: {
        from: 0,
        to: currentContent.length,
        insert: documentContent,
      },
      annotations: externalUpdate.of(true),
    })
  }, [documentContent, documentIsBinary, documentIsLoading, documentReadFailed])

  useEffect(() => {
    const editor = editorViewRef.current
    if (!editor || documentContent == null || documentIsBinary || documentIsLoading || documentReadFailed) return
    editor.dispatch({
      effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(!documentIsSaving)),
    })
  }, [documentContent, documentIsBinary, documentIsLoading, documentIsSaving, documentReadFailed])

  useEffect(() => {
    let cancelled = false
    if (documentContent == null || documentIsBinary || documentIsLoading || documentReadFailed) {
      setLanguageLabel(null)
      return
    }

    if (documentSyntaxMode === 'none') {
      setLanguageLabel(`${ext} LARGE`)
      if (editorViewRef.current) {
        editorViewRef.current.dispatch({
          effects: languageCompartmentRef.current.reconfigure([]),
        })
      }
      return
    }

    void fileSyntaxProfile(tab.projectId, filePath)
      .then(async (profile) => {
        if (cancelled) return
        setLanguageLabel(profile.displayName)
        if (documentSyntaxMode !== 'full') {
          if (!editorViewRef.current) return
          editorViewRef.current.dispatch({
            effects: languageCompartmentRef.current.reconfigure([]),
          })
          return
        }
        const support = await resolveLanguageExtension(profile.languageId, filePath)
        if (cancelled || !editorViewRef.current) return
        editorViewRef.current.dispatch({
          effects: languageCompartmentRef.current.reconfigure(support),
        })
      })
      .catch(() => {
        if (cancelled) return
        setLanguageLabel(null)
      })

    return () => {
      cancelled = true
    }
  }, [documentContent, documentIsBinary, documentIsLoading, documentKey, documentReadFailed, documentSyntaxMode, ext, filePath, tab.projectId])

  useEffect(() => {
    const editor = editorViewRef.current
    if (!editor) return
    if (documentContent == null || documentIsBinary || documentIsLoading || documentReadFailed) {
      editor.dispatch({ effects: setSyntaxDecorations.of([]) })
      return
    }
    if (documentSyntaxMode !== 'full') {
      editor.dispatch({ effects: setSyntaxDecorations.of([]) })
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      void fileSyntaxTokens({
        projectId: tab.projectId,
        path: filePath,
        content: documentContent,
      })
        .then((response) => {
          if (cancelled || !editorViewRef.current) return
          editorViewRef.current.dispatch({
            effects: setSyntaxDecorations.of(response.tokens),
          })
        })
        .catch(() => {
          if (cancelled || !editorViewRef.current) return
          editorViewRef.current.dispatch({ effects: setSyntaxDecorations.of([]) })
        })
    }, 90)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [documentContent, documentIsBinary, documentIsLoading, documentKey, documentReadFailed, documentSyntaxMode, filePath, tab.projectId])

  const focusMatch = (nextIndex: number) => {
    const editor = editorViewRef.current
    if (!editor || matches.length === 0) return
    const bounded = ((nextIndex % matches.length) + matches.length) % matches.length
    const match = matches[bounded]
    if (!match) return
    editor.dispatch({
      selection: { anchor: match.start, head: match.end },
      scrollIntoView: true,
    })
    editor.focus()
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

  useEffect(() => {
    const onSurfaceSave = (event: Event) => {
      const detail = (event as CustomEvent<{ tabId?: string; type?: string }>).detail
      if (!detail || detail.tabId !== tab.id || detail.type !== 'editor') return
      void onSave()
    }

    const onSurfaceFind = (event: Event) => {
      const detail = (event as CustomEvent<{ tabId?: string; type?: string }>).detail
      if (!detail || detail.tabId !== tab.id || detail.type !== 'editor') return
      setFindOpen(true)
      queueMicrotask(() => {
        editorViewRef.current?.focus()
      })
    }

    window.addEventListener('ice:surface:save', onSurfaceSave as EventListener)
    window.addEventListener('ice:surface:find', onSurfaceFind as EventListener)
    return () => {
      window.removeEventListener('ice:surface:save', onSurfaceSave as EventListener)
      window.removeEventListener('ice:surface:find', onSurfaceFind as EventListener)
    }
  }, [onSave, tab.id])

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
          <span className={styles.langBadge}>{languageLabel ?? ext}</span>
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
      {findOpen && !document?.isBinary && !document?.isLoading && !document?.readFailed && document ? (
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
      ) : document?.readFailed ? (
        <div className={styles.loadingState}>
          <AlertTriangle size={16} />
          <span>File could not be loaded.</span>
        </div>
      ) : document?.isLoading || !document ? (
        <div className={styles.loadingState}>
          <Loader2 size={16} className={styles.spinner} />
          <span>Loading file...</span>
        </div>
      ) : (
        <div className={styles.editorShell}>
          <div ref={editorRootRef} className={styles.editorRoot} />
        </div>
      )}
    </div>
  )
})

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

function buildEditorTheme(): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      width: '100%',
      minWidth: '0',
      minHeight: '0',
      backgroundColor: 'transparent',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
    },
    '.cm-scroller': {
      minWidth: '0',
      fontFamily: 'var(--font-mono)',
      lineHeight: '20px',
      overflow: 'auto',
    },
    '.cm-content': {
      minWidth: '0',
      padding: '12px 16px',
      caretColor: 'var(--text-primary)',
    },
    '.cm-focused': {
      outline: 'none',
    },
    '.cm-gutters': {
      backgroundColor: 'color-mix(in srgb, var(--bg-panel) 72%, var(--bg-surface))',
      color: 'var(--text-disabled)',
      borderRight: '1px solid var(--border-variant)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 12px 0 0',
      minWidth: '44px',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--bg-element-selected) 14%, transparent)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--bg-element-selected) 42%, transparent)',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--bg-element-selected) 28%, transparent)',
      outline: '1px solid var(--border-variant)',
    },
    '.cm-ice-token-keyword': {
      color: 'var(--syn-keyword)',
      fontWeight: 'var(--weight-medium)',
    },
    '.cm-ice-token-function': {
      color: 'var(--syn-function)',
    },
    '.cm-ice-token-type': {
      color: 'var(--syn-type)',
    },
    '.cm-ice-token-variable': {
      color: 'var(--text-primary)',
    },
    '.cm-ice-token-string': {
      color: 'var(--syn-string)',
    },
    '.cm-ice-token-number': {
      color: 'var(--syn-constant)',
    },
    '.cm-ice-token-comment': {
      color: 'var(--syn-comment)',
    },
    '.cm-ice-token-operator': {
      color: 'var(--text-primary)',
    },
  })
}

function buildSyntaxDecorations(state: EditorState, tokens: BackendSyntaxToken[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()

  for (const token of tokens) {
    if (token.length <= 0 || token.line < 0 || token.line >= state.doc.lines) {
      continue
    }

    const line = state.doc.line(token.line + 1)
    const start = Math.min(Math.max(token.start, 0), line.length)
    const end = Math.min(start + token.length, line.length)
    if (end <= start) continue

    builder.add(
      line.from + start,
      line.from + end,
      Decoration.mark({ class: syntaxTokenClass(token.tokenType) }),
    )
  }

  return builder.finish()
}

function syntaxTokenClass(tokenType: string) {
  switch (tokenType) {
    case 'keyword':
      return 'cm-ice-token-keyword'
    case 'function':
      return 'cm-ice-token-function'
    case 'type':
      return 'cm-ice-token-type'
    case 'string':
      return 'cm-ice-token-string'
    case 'number':
      return 'cm-ice-token-number'
    case 'comment':
      return 'cm-ice-token-comment'
    case 'operator':
      return 'cm-ice-token-operator'
    default:
      return 'cm-ice-token-variable'
  }
}

async function resolveLanguageExtension(languageId: string, filePath: string): Promise<Extension> {
  const normalized = languageId.toLowerCase()
  const language = languages.find((description) => {
    const name = description.name.toLowerCase()
    return name === normalized || description.alias.some((alias) => alias.toLowerCase() === normalized)
  }) ?? LanguageDescription.matchFilename(languages, filePath)

  if (!language) {
    return []
  }

  try {
    return await language.load()
  } catch {
    return []
  }
}
