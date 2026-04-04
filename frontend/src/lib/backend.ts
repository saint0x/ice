import { invoke } from '@tauri-apps/api/core'
import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  FileEntry,
  GitChange,
  GitState,
  PaneLayout,
  Project,
  Tab,
} from '@/types'

interface ProjectSummaryDto {
  id: string
  name: string
  rootPath: string
  colorToken: string
  gitBranch?: string | null
}

interface WorkspaceChromeDto {
  sidebarOpen: boolean
  sidebarWidth: number
  bottomDockOpen: boolean
  bottomDockHeight: number
  chatPanelOpen: boolean
  chatPanelWidth: number
}

interface WorkspaceTabDto {
  id: string
  projectId: string
  kind: string
  title: string
  icon?: string | null
  dirty: boolean
  pinned: boolean
  meta?: Record<string, unknown> | null
}

interface WorkspacePaneLeafDto {
  type: 'leaf'
  id: string
  tabs: string[]
  activeTabId?: string | null
}

interface WorkspacePaneSplitDto {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  children: WorkspacePaneDto[]
  ratio: number
}

type WorkspacePaneDto = WorkspacePaneLeafDto | WorkspacePaneSplitDto

interface WorkspaceSessionDto {
  activePaneId: string
  tabs: WorkspaceTabDto[]
  root: WorkspacePaneDto
}

interface AppBootstrapDto {
  projects: ProjectSummaryDto[]
  workspaceChrome: WorkspaceChromeDto
  workspaceSession: WorkspaceSessionDto
}

interface FsTreeNodeDto {
  path: string
  name: string
  isDir: boolean
  depth: number
  gitStatus?: FileEntry['gitStatus']
  isHidden: boolean
  children: FsTreeNodeDto[]
}

interface GitStatusSummaryDto {
  branch?: string | null
  ahead: number
  behind: number
  changes: GitChange[]
}

type WorkspaceChromePersistDto = WorkspaceChromeDto

interface WorkspaceTabPersistDto {
  id: string
  projectId: string
  kind: string
  title: string
  icon?: string | null
  dirty: boolean
  pinned: boolean
  meta?: Record<string, unknown> | null
}

type WorkspacePanePersistDto = WorkspacePaneDto

interface WorkspaceSessionPersistDto {
  activePaneId: string
  tabs: WorkspaceTabPersistDto[]
  root: WorkspacePanePersistDto
}

interface GitEventPayload {
  type: string
  projectId: string
  summary?: GitStatusSummaryDto
}

interface FsEventPayload {
  type: string
  projectId: string
}

export async function appBootstrap() {
  return invoke<AppBootstrapDto>('app_bootstrap')
}

export async function projectTreeReadNested(projectId: string) {
  return invoke<FsTreeNodeDto[]>('project_tree_read_nested', {
    input: { projectId, depth: 8, includeHidden: false, respectGitignore: true, maxEntries: 5000 },
  })
}

export async function gitStatusRead(projectId: string) {
  return invoke<GitStatusSummaryDto>('git_status_read', { projectId })
}

export async function projectWatchStart(projectId: string) {
  return invoke<void>('project_watch_start', { projectId })
}

export async function projectWatchStop(projectId: string) {
  return invoke<void>('project_watch_stop', { projectId })
}

export async function workspaceChromeSet(chromeState: WorkspaceChromePersistDto) {
  return invoke<void>('workspace_chrome_set', {
    input: {
      workspaceId: 'primary',
      chromeState,
    },
  })
}

export async function workspaceSessionSet(sessionState: WorkspaceSessionPersistDto) {
  return invoke<void>('workspace_session_set', {
    input: {
      workspaceId: 'primary',
      sessionState,
    },
  })
}

export function listenGitEvents(handler: (payload: GitEventPayload) => void): Promise<UnlistenFn> {
  return listen<GitEventPayload>('app://git', (event: Event<GitEventPayload>) => {
    if (event.payload) handler(event.payload)
  })
}

export function listenFsEvents(handler: (payload: FsEventPayload) => void): Promise<UnlistenFn> {
  return listen<FsEventPayload>('app://fs', (event: Event<FsEventPayload>) => {
    if (event.payload) handler(event.payload)
  })
}

export function toProject(dto: ProjectSummaryDto): Project {
  return {
    id: dto.id,
    name: dto.name,
    path: dto.rootPath,
    color: dto.colorToken,
    branch: dto.gitBranch ?? 'detached',
    collapsed: false,
    expandedSections: new Set(['files']),
  }
}

export function toFileTree(nodes: FsTreeNodeDto[]): FileEntry[] {
  return nodes.map((node) => ({
    name: node.name,
    path: node.path,
    isDir: node.isDir,
    depth: node.depth,
    gitStatus: node.gitStatus,
    expanded: node.isDir && node.depth === 0,
    children: toFileTree(node.children),
  }))
}

export function toGitState(dto: GitStatusSummaryDto): GitState {
  return {
    branch: dto.branch ?? 'detached',
    ahead: dto.ahead,
    behind: dto.behind,
    changes: dto.changes,
  }
}

export function toWorkspaceInput(
  chrome: WorkspaceChromeDto,
  session: WorkspaceSessionDto,
): {
  layout: PaneLayout
  tabs: Tab[]
  activePaneId: string
  sidebarOpen: boolean
  sidebarWidth: number
  bottomDockOpen: boolean
  bottomDockHeight: number
  chatPanelOpen: boolean
  chatPanelWidth: number
} {
  return {
    layout: toPaneLayout(session.root),
    tabs: session.tabs.map(toTab),
    activePaneId: session.activePaneId,
    sidebarOpen: chrome.sidebarOpen,
    sidebarWidth: chrome.sidebarWidth,
    bottomDockOpen: chrome.bottomDockOpen,
    bottomDockHeight: chrome.bottomDockHeight,
    chatPanelOpen: chrome.chatPanelOpen,
    chatPanelWidth: chrome.chatPanelWidth,
  }
}

export function toWorkspaceChromePersist(input: {
  sidebarOpen: boolean
  sidebarWidth: number
  bottomDockOpen: boolean
  bottomDockHeight: number
  chatPanelOpen: boolean
  chatPanelWidth: number
}): WorkspaceChromePersistDto {
  return input
}

export function toWorkspaceSessionPersist(input: {
  activePaneId: string
  layout: PaneLayout
  tabs: Map<string, Tab>
}): WorkspaceSessionPersistDto {
  return {
    activePaneId: input.activePaneId,
    tabs: [...input.tabs.values()].map((tab) => ({
      id: tab.id,
      projectId: tab.projectId,
      kind: tab.type,
      title: tab.title,
      icon: tab.icon ?? null,
      dirty: tab.dirty ?? false,
      pinned: tab.pinned ?? false,
      meta: tab.meta ?? null,
    })),
    root: toPanePersist(input.layout),
  }
}

function toTab(dto: WorkspaceTabDto): Tab {
  return {
    id: dto.id,
    projectId: dto.projectId,
    type: normalizeContentType(dto.kind),
    title: dto.title,
    icon: dto.icon ?? undefined,
    dirty: dto.dirty,
    pinned: dto.pinned,
    meta: dto.meta ?? undefined,
  }
}

function normalizeContentType(kind: string): Tab['type'] {
  if (
    kind === 'editor' ||
    kind === 'browser' ||
    kind === 'terminal' ||
    kind === 'git' ||
    kind === 'codex' ||
    kind === 'settings'
  ) {
    return kind
  }
  return 'settings'
}

function toPaneLayout(dto: WorkspacePaneDto): PaneLayout {
  if (dto.type === 'leaf') {
    return {
      id: dto.id,
      type: 'leaf',
      tabs: dto.tabs,
      activeTabId: dto.activeTabId ?? null,
    }
  }
  return {
    id: dto.id,
    type: 'split',
    direction: dto.direction,
    children: dto.children.map(toPaneLayout),
    ratio: dto.ratio,
  }
}

function toPanePersist(layout: PaneLayout): WorkspacePanePersistDto {
  if (layout.type === 'leaf') {
    return {
      type: 'leaf',
      id: layout.id,
      tabs: layout.tabs,
      activeTabId: layout.activeTabId,
    }
  }
  return {
    type: 'split',
    id: layout.id,
    direction: layout.direction,
    children: layout.children.map(toPanePersist),
    ratio: layout.ratio,
  }
}
