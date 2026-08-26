import { fileRead } from '@/lib/backend'
import type { FileEntry, Tab } from '@/types'
import { useEditorStore, type EditorDocument } from '@/stores/editor'

const inflightLoads = new Map<string, Promise<EditorDocument | null>>()
const queuedPrefetchKeys = new Set<string>()
const prefetchQueue: Array<{ projectId: string; path: string }> = []
const PREFETCH_CONCURRENCY = 8
const PROJECT_PREFETCH_LIMIT = 24
const TREE_PREFETCH_LIMIT = 12
let activePrefetches = 0
const FULL_SYNTAX_MAX_BYTES = 256 * 1024
const REDUCED_SYNTAX_MAX_BYTES = 1024 * 1024

function documentKey(projectId: string, path: string) {
  return `${projectId}:${path}`
}

function detectSyntaxMode(sizeBytes: number): EditorDocument['syntaxMode'] {
  if (sizeBytes <= FULL_SYNTAX_MAX_BYTES) return 'full'
  if (sizeBytes <= REDUCED_SYNTAX_MAX_BYTES) return 'reduced'
  return 'none'
}

function toEditorDocument(projectId: string, path: string, result: Awaited<ReturnType<typeof fileRead>>): EditorDocument {
  const now = Date.now()
  return {
    projectId,
    path,
    content: result.content ?? '',
    isBinary: result.isBinary,
    sizeBytes: result.sizeBytes,
    encoding: result.encoding ?? undefined,
    hasBom: result.hasBom,
    modifiedAtMs: result.modifiedAtMs ?? undefined,
    versionToken: result.versionToken ?? undefined,
    loadedAt: now,
    lastTouchedAt: now,
    syntaxMode: detectSyntaxMode(result.sizeBytes),
    isDirty: false,
    isLoading: false,
    isSaving: false,
    conflict: undefined,
  }
}

function collectLeafPaths(entries: FileEntry[], paths: string[], limit = Number.POSITIVE_INFINITY) {
  for (const entry of entries) {
    if (paths.length >= limit) return
    if (entry.isDir) {
      if (!entry.expanded && entry.depth > 0) continue
      if (entry.children) collectLeafPaths(entry.children, paths, limit)
      continue
    }
    paths.push(entry.path)
  }
}

function pumpPrefetchQueue() {
  while (activePrefetches < PREFETCH_CONCURRENCY && prefetchQueue.length > 0) {
    const next = prefetchQueue.shift()
    if (!next) break
    const key = documentKey(next.projectId, next.path)
    const current = useEditorStore.getState().documents.get(key)
    if (current && !current.isLoading) {
      queuedPrefetchKeys.delete(key)
      continue
    }

    activePrefetches += 1
    void ensureEditorDocument(next.projectId, next.path, { silent: true })
      .finally(() => {
        activePrefetches = Math.max(0, activePrefetches - 1)
        queuedPrefetchKeys.delete(key)
        pumpPrefetchQueue()
      })
  }
}

export async function ensureEditorDocument(
  projectId: string,
  path: string,
  options?: { force?: boolean; silent?: boolean },
) {
  const key = documentKey(projectId, path)
  const store = useEditorStore.getState()
  const current = store.documents.get(key)
  if (!options?.force && current && !current.isLoading && !current.readFailed) {
    store.touchDocument(projectId, path)
    return current
  }

  const existing = inflightLoads.get(key)
  if (existing) return existing

  store.setLoading(projectId, path)
  const loadPromise = fileRead(projectId, path)
    .then((result) => {
      const document = toEditorDocument(projectId, path, result)
      const state = useEditorStore.getState()
      state.hydrateDocument(document)
      state.pruneCachedDocuments()
      return document
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to read file'
      if (!options?.silent) {
        useEditorStore.getState().setError(projectId, path, message)
      } else {
        useEditorStore.getState().discardPendingLoad(projectId, path)
      }
      return null
    })
    .finally(() => {
      inflightLoads.delete(key)
    })

  inflightLoads.set(key, loadPromise)
  return loadPromise
}

export function scheduleEditorPrefetch(
  projectId: string,
  paths: string[],
  options?: { eager?: boolean; priority?: boolean },
) {
  const uniquePaths = Array.from(new Set(paths.filter((path) => path.trim().length > 0)))
  if (uniquePaths.length === 0) return

  const run = () => {
    const pathsToQueue = options?.priority ? [...uniquePaths].reverse() : uniquePaths
    for (const path of pathsToQueue) {
      const key = documentKey(projectId, path)
      const current = useEditorStore.getState().documents.get(key)
      if ((current && !current.isLoading) || inflightLoads.has(key) || queuedPrefetchKeys.has(key)) {
        continue
      }
      queuedPrefetchKeys.add(key)
      if (options?.priority) {
        prefetchQueue.unshift({ projectId, path })
      } else {
        prefetchQueue.push({ projectId, path })
      }
    }
    pumpPrefetchQueue()
  }

  if (options?.eager) {
    globalThis.setTimeout(run, 0)
    return
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => run(), { timeout: 120 })
    return
  }
  globalThis.setTimeout(run, 24)
}

export function buildProjectPrefetchPlan(input: {
  projectId: string
  tree: FileEntry[]
  selectedPath?: string | null
  openTabs?: Tab[]
}) {
  const projectTabs = (input.openTabs ?? []).filter(
    (tab) => tab.projectId === input.projectId && tab.type === 'editor' && typeof tab.meta?.path === 'string',
  )
  const priorityPaths = projectTabs
    .map((tab) => tab.meta?.path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
  if (input.selectedPath) {
    priorityPaths.push(input.selectedPath)
  }

  const allPaths: string[] = []
  collectLeafPaths(input.tree, allPaths, TREE_PREFETCH_LIMIT)
  return Array.from(new Set([...priorityPaths, ...allPaths])).slice(0, PROJECT_PREFETCH_LIMIT)
}

export function prefetchProjectDocuments(input: {
  projectId: string
  tree: FileEntry[]
  selectedPath?: string | null
  openTabs?: Tab[]
  eager?: boolean
}) {
  const paths = buildProjectPrefetchPlan(input)
  scheduleEditorPrefetch(input.projectId, paths, {
    eager: input.eager,
    priority: input.eager,
  })
}
