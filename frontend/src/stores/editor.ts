import { create } from 'zustand'
import { useWorkspaceStore } from '@/stores/workspace'

export interface EditorDocument {
  projectId: string
  path: string
  content: string
  isBinary: boolean
  sizeBytes: number
  encoding?: string
  hasBom: boolean
  modifiedAtMs?: number
  versionToken?: string
  loadedAt: number
  lastTouchedAt: number
  syntaxMode: 'full' | 'reduced' | 'none'
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  readFailed?: boolean
  error?: string
  conflict?: {
    latestContent: string
    latestVersionToken?: string
    latestModifiedAtMs?: number
    latestEncoding?: string
    latestHasBom: boolean
    mergeDraft?: string
  }
}

interface EditorState {
  documents: Map<string, EditorDocument>
  removedProjectIds: Set<string>
  setLoading: (projectId: string, path: string) => void
  hydrateDocument: (document: EditorDocument) => void
  updateContent: (projectId: string, path: string, content: string) => void
  touchDocument: (projectId: string, path: string) => void
  pruneCachedDocuments: (limits?: { maxDocuments?: number; maxBytes?: number }) => void
  markSaved: (projectId: string, path: string, payload: Omit<EditorDocument, 'isDirty' | 'isLoading' | 'isSaving'>) => void
  setSaving: (projectId: string, path: string, isSaving: boolean) => void
  setError: (projectId: string, path: string, error?: string) => void
  discardPendingLoad: (projectId: string, path: string) => void
  setConflict: (
    projectId: string,
    path: string,
    conflict: NonNullable<EditorDocument['conflict']>,
    error?: string,
  ) => void
  updateConflictMergeDraft: (projectId: string, path: string, mergeDraft: string) => void
  removeDocument: (projectId: string, path: string) => void
  renameDocument: (projectId: string, from: string, to: string) => void
  reloadFromDisk: (
    projectId: string,
    path: string,
    payload: Omit<EditorDocument, 'isDirty' | 'isLoading' | 'isSaving'>,
  ) => void
  removeProjectDocuments: (projectId: string) => void
}

function documentKey(projectId: string, path: string) {
  return `${projectId}:${path}`
}

const DEFAULT_CACHE_DOCUMENTS = 96
const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024

export const useEditorStore = create<EditorState>((set) => ({
  documents: new Map(),
  removedProjectIds: new Set(),

  setLoading: (projectId, path) =>
    set((state) => {
      if (state.removedProjectIds.has(projectId)) return state
      const key = documentKey(projectId, path)
      const documents = new Map(state.documents)
      const current = documents.get(key)
      documents.set(key, {
        projectId,
        path,
        content: current?.content ?? '',
        isBinary: current?.isBinary ?? false,
        sizeBytes: current?.sizeBytes ?? 0,
        encoding: current?.encoding,
        hasBom: current?.hasBom ?? false,
        modifiedAtMs: current?.modifiedAtMs,
        versionToken: current?.versionToken,
        loadedAt: current?.loadedAt ?? Date.now(),
        lastTouchedAt: Date.now(),
        syntaxMode: current?.syntaxMode ?? 'full',
        isDirty: current?.isDirty ?? false,
        isLoading: true,
        isSaving: current?.isSaving ?? false,
        readFailed: false,
        error: undefined,
        conflict: current?.conflict,
      })
      return { documents }
    }),

  hydrateDocument: (document) =>
    set((state) => {
      if (state.removedProjectIds.has(document.projectId)) return state
      const documents = new Map(state.documents)
      const key = documentKey(document.projectId, document.path)
      const current = documents.get(key)
      if (current?.isDirty || current?.isSaving) return state
      documents.set(key, document)
      return { documents }
    }),

  updateContent: (projectId, path, content) =>
    set((state) => {
      if (state.removedProjectIds.has(projectId)) return state
      const key = documentKey(projectId, path)
      const documents = new Map(state.documents)
      const current = documents.get(key)
      if (!current) return state
      documents.set(key, {
        ...current,
        content,
        sizeBytes: current.isBinary ? current.sizeBytes : new TextEncoder().encode(content).length,
        lastTouchedAt: Date.now(),
        isDirty: content !== current.content ? true : current.isDirty,
        error: undefined,
        conflict: undefined,
      })
      return { documents }
    }),

  touchDocument: (projectId, path) =>
    set((state) => {
      if (state.removedProjectIds.has(projectId)) return state
      const key = documentKey(projectId, path)
      const current = state.documents.get(key)
      if (!current) return state
      const documents = new Map(state.documents)
      documents.set(key, {
        ...current,
        lastTouchedAt: Date.now(),
      })
      return { documents }
    }),

  pruneCachedDocuments: (limits) =>
    set((state) => {
      const maxDocuments = limits?.maxDocuments ?? DEFAULT_CACHE_DOCUMENTS
      const maxBytes = limits?.maxBytes ?? DEFAULT_CACHE_BYTES
      const candidates = Array.from(state.documents.values())
      let totalBytes = candidates.reduce((sum, document) => sum + document.sizeBytes, 0)
      if (candidates.length <= maxDocuments && totalBytes <= maxBytes) {
        return state
      }

      const protectedKeys = new Set(
        Array.from(useWorkspaceStore.getState().tabs.values())
          .filter((tab) => tab.type === 'editor' && typeof tab.meta?.path === 'string')
          .map((tab) => documentKey(tab.projectId, tab.meta?.path as string)),
      )

      const evictable = candidates
        .filter((document) => (
          !document.isDirty
          && !document.isSaving
          && !document.isLoading
          && !protectedKeys.has(documentKey(document.projectId, document.path))
        ))
        .sort((left, right) => left.lastTouchedAt - right.lastTouchedAt)
      if (evictable.length === 0) return state

      const documents = new Map(state.documents)
      let count = candidates.length
      for (const document of evictable) {
        if (count <= maxDocuments && totalBytes <= maxBytes) break
        documents.delete(documentKey(document.projectId, document.path))
        count -= 1
        totalBytes -= document.sizeBytes
      }
      return { documents }
    }),

  markSaved: (projectId, path, payload) =>
    set((state) => {
      if (state.removedProjectIds.has(projectId)) return state
      const documents = new Map(state.documents)
      const key = documentKey(projectId, path)
      const current = documents.get(key)
      const hasNewerLocalContent = Boolean(current?.isDirty && current.content !== payload.content)
      documents.set(key, {
        ...payload,
        projectId,
        path,
        content: hasNewerLocalContent ? current!.content : payload.content,
        sizeBytes: hasNewerLocalContent
          ? new TextEncoder().encode(current!.content).length
          : payload.sizeBytes,
        isDirty: hasNewerLocalContent,
        isLoading: false,
        isSaving: false,
        readFailed: false,
        loadedAt: payload.loadedAt ?? Date.now(),
        lastTouchedAt: Date.now(),
        error: undefined,
        conflict: undefined,
      })
      return { documents }
    }),

  setSaving: (projectId, path, isSaving) =>
    set((state) => {
      if (state.removedProjectIds.has(projectId)) return state
      const key = documentKey(projectId, path)
      const current = state.documents.get(key)
      if (!current) return state
      const documents = new Map(state.documents)
      documents.set(key, { ...current, isSaving })
      return { documents }
    }),

  setError: (projectId, path, error) =>
    set((state) => {
      if (state.removedProjectIds.has(projectId)) return state
      const key = documentKey(projectId, path)
      const current = state.documents.get(key)
      if (!current) return state
      const readFailed = current.isLoading && !current.isDirty && !current.isSaving
      const documents = new Map(state.documents)
      documents.set(key, {
        projectId,
        path,
        content: current.content,
        isBinary: current.isBinary,
        sizeBytes: current.sizeBytes,
        encoding: current.encoding,
        hasBom: current.hasBom,
        modifiedAtMs: current.modifiedAtMs,
        versionToken: current.versionToken,
        loadedAt: current.loadedAt,
        lastTouchedAt: Date.now(),
        syntaxMode: current.syntaxMode,
        isDirty: current.isDirty,
        isLoading: false,
        isSaving: false,
        readFailed,
        error,
        conflict: current.conflict,
      })
      return { documents }
    }),

  discardPendingLoad: (projectId, path) =>
    set((state) => {
      const key = documentKey(projectId, path)
      const current = state.documents.get(key)
      if (!current || !current.isLoading || current.isDirty || current.isSaving) return state
      const documents = new Map(state.documents)
      documents.delete(key)
      return { documents }
    }),

  setConflict: (projectId, path, conflict, error) =>
    set((state) => {
      if (state.removedProjectIds.has(projectId)) return state
      const key = documentKey(projectId, path)
      const current = state.documents.get(key)
      if (!current) return state
      const documents = new Map(state.documents)
      documents.set(key, {
        ...current,
        isLoading: false,
        isSaving: false,
        readFailed: false,
        error,
        conflict,
      })
      return { documents }
    }),

  updateConflictMergeDraft: (projectId, path, mergeDraft) =>
    set((state) => {
      if (state.removedProjectIds.has(projectId)) return state
      const key = documentKey(projectId, path)
      const current = state.documents.get(key)
      if (!current?.conflict) return state
      const documents = new Map(state.documents)
      documents.set(key, {
        ...current,
        conflict: {
          ...current.conflict,
          mergeDraft,
        },
      })
      return { documents }
    }),

  removeDocument: (projectId, path) =>
    set((state) => {
      if (state.removedProjectIds.has(projectId)) return state
      const documents = new Map(state.documents)
      documents.delete(documentKey(projectId, path))
      return { documents }
    }),

  renameDocument: (projectId, from, to) =>
    set((state) => {
      if (state.removedProjectIds.has(projectId)) return state
      const fromKey = documentKey(projectId, from)
      const current = state.documents.get(fromKey)
      if (!current) return state
      const documents = new Map(state.documents)
      documents.delete(fromKey)
      documents.set(documentKey(projectId, to), {
        ...current,
        path: to,
        lastTouchedAt: Date.now(),
      })
      return { documents }
    }),

  reloadFromDisk: (projectId, path, payload) =>
    set((state) => {
      if (state.removedProjectIds.has(projectId)) return state
      const documents = new Map(state.documents)
      documents.set(documentKey(projectId, path), {
        ...payload,
        projectId,
        path,
        isDirty: false,
        isLoading: false,
        isSaving: false,
        readFailed: false,
        loadedAt: payload.loadedAt ?? Date.now(),
        lastTouchedAt: Date.now(),
        error: undefined,
        conflict: undefined,
      })
      return { documents }
    }),

  removeProjectDocuments: (projectId) =>
    set((state) => {
      const documents = new Map(state.documents)
      for (const [key, document] of documents.entries()) {
        if (document.projectId === projectId) {
          documents.delete(key)
        }
      }
      const removedProjectIds = new Set(state.removedProjectIds)
      removedProjectIds.add(projectId)
      return { documents, removedProjectIds }
    }),
}))
