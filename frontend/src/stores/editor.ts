import { create } from 'zustand'

export interface EditorDocument {
  projectId: string
  path: string
  content: string
  isBinary: boolean
  encoding?: string
  hasBom: boolean
  modifiedAtMs?: number
  versionToken?: string
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  error?: string
  conflict?: {
    latestContent: string
    latestVersionToken?: string
    latestModifiedAtMs?: number
    latestEncoding?: string
    latestHasBom: boolean
  }
}

interface EditorState {
  documents: Map<string, EditorDocument>
  setLoading: (projectId: string, path: string) => void
  hydrateDocument: (document: EditorDocument) => void
  updateContent: (projectId: string, path: string, content: string) => void
  markSaved: (projectId: string, path: string, payload: Omit<EditorDocument, 'isDirty' | 'isLoading' | 'isSaving'>) => void
  setSaving: (projectId: string, path: string, isSaving: boolean) => void
  setError: (projectId: string, path: string, error?: string) => void
  setConflict: (
    projectId: string,
    path: string,
    conflict: NonNullable<EditorDocument['conflict']>,
    error?: string,
  ) => void
  reloadFromDisk: (
    projectId: string,
    path: string,
    payload: Omit<EditorDocument, 'isDirty' | 'isLoading' | 'isSaving'>,
  ) => void
}

function documentKey(projectId: string, path: string) {
  return `${projectId}:${path}`
}

export const useEditorStore = create<EditorState>((set) => ({
  documents: new Map(),

  setLoading: (projectId, path) =>
    set((state) => {
      const key = documentKey(projectId, path)
      const documents = new Map(state.documents)
      const current = documents.get(key)
      documents.set(key, {
        projectId,
        path,
        content: current?.content ?? '',
        isBinary: current?.isBinary ?? false,
        encoding: current?.encoding,
        hasBom: current?.hasBom ?? false,
        modifiedAtMs: current?.modifiedAtMs,
        versionToken: current?.versionToken,
        isDirty: current?.isDirty ?? false,
        isLoading: true,
        isSaving: current?.isSaving ?? false,
        error: undefined,
        conflict: current?.conflict,
      })
      return { documents }
    }),

  hydrateDocument: (document) =>
    set((state) => {
      const documents = new Map(state.documents)
      documents.set(documentKey(document.projectId, document.path), document)
      return { documents }
    }),

  updateContent: (projectId, path, content) =>
    set((state) => {
      const key = documentKey(projectId, path)
      const documents = new Map(state.documents)
      const current = documents.get(key)
      if (!current) return state
      documents.set(key, {
        ...current,
        content,
        isDirty: content !== current.content ? true : current.isDirty,
        error: undefined,
        conflict: undefined,
      })
      return { documents }
    }),

  markSaved: (projectId, path, payload) =>
    set((state) => {
      const documents = new Map(state.documents)
      documents.set(documentKey(projectId, path), {
        ...payload,
        projectId,
        path,
        isDirty: false,
        isLoading: false,
        isSaving: false,
        error: undefined,
        conflict: undefined,
      })
      return { documents }
    }),

  setSaving: (projectId, path, isSaving) =>
    set((state) => {
      const key = documentKey(projectId, path)
      const current = state.documents.get(key)
      if (!current) return state
      const documents = new Map(state.documents)
      documents.set(key, { ...current, isSaving })
      return { documents }
    }),

  setError: (projectId, path, error) =>
    set((state) => {
      const key = documentKey(projectId, path)
      const current = state.documents.get(key)
      if (!current) return state
      const documents = new Map(state.documents)
      documents.set(key, { ...current, isLoading: false, isSaving: false, error })
      return { documents }
    }),

  setConflict: (projectId, path, conflict, error) =>
    set((state) => {
      const key = documentKey(projectId, path)
      const current = state.documents.get(key)
      if (!current) return state
      const documents = new Map(state.documents)
      documents.set(key, {
        ...current,
        isLoading: false,
        isSaving: false,
        error,
        conflict,
      })
      return { documents }
    }),

  reloadFromDisk: (projectId, path, payload) =>
    set((state) => {
      const documents = new Map(state.documents)
      documents.set(documentKey(projectId, path), {
        ...payload,
        projectId,
        path,
        isDirty: false,
        isLoading: false,
        isSaving: false,
        error: undefined,
        conflict: undefined,
      })
      return { documents }
    }),
}))
