import { invoke } from '@tauri-apps/api/core'
import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  BrowserTab,
  CodexApproval,
  CodexThread,
  FileEntry,
  GitChange,
  GitState,
  PaneLayout,
  Project,
  TerminalSession,
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

interface TerminalSessionRecordDto {
  sessionId: string
  projectId: string
  cwd: string
  shell: string
  shellPath: string
  title: string
  cols: number
  rows: number
  isRunning: boolean
  startupCommand?: string | null
  restoredFromPersistence: boolean
  scrollbackBytes: number
  lastExitReason?: string | null
}

interface TerminalScrollbackDto {
  sessionId: string
  content: string
}

interface TerminalEventPayload {
  type: string
  session?: TerminalSessionRecordDto
  sessionId?: string
  data?: string
}

interface CodexThreadDto {
  projectId: string
  threadId: string
  title?: string | null
  status: string
  lastAssistantMessage?: string | null
  unread: boolean
}

interface CodexApprovalDto {
  requestId: number
  projectId: string
  threadId?: string | null
  actionType: string
  category: string
  riskLevel: string
  policyAction: string
  policyReason?: string | null
  description: string
  contextJson?: unknown
}

interface CodexEventPayload {
  type: string
  thread?: CodexThreadDto
  approval?: CodexApprovalDto
}

interface BrowserTabDto {
  tabId: string
  projectId: string
  url: string
  title: string
  isPinned: boolean
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  faviconUrl?: string | null
  securityOrigin?: string | null
  isSecure: boolean
}

interface BrowserEventPayload {
  type: string
  tab?: BrowserTabDto
  tabId?: string
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

export async function terminalList(projectId?: string) {
  return invoke<TerminalSessionRecordDto[]>('terminal_list', { projectId })
}

export async function terminalCreate(projectId: string) {
  return invoke<TerminalSessionRecordDto>('terminal_create', {
    input: { projectId },
  })
}

export async function terminalClose(sessionId: string) {
  return invoke<void>('terminal_close', { sessionId })
}

export async function terminalWrite(sessionId: string, data: string) {
  return invoke<void>('terminal_write', {
    input: { sessionId, data },
  })
}

export async function terminalScrollbackRead(sessionId: string) {
  return invoke<TerminalScrollbackDto>('terminal_scrollback_read', {
    input: { sessionId },
  })
}

export async function terminalRespawn(sessionId: string) {
  return invoke<TerminalSessionRecordDto>('terminal_respawn', { sessionId })
}

export async function codexThreadsList(projectId?: string) {
  return invoke<CodexThreadDto[]>('codex_threads_list', { projectId })
}

export async function codexApprovalsList(projectId?: string) {
  return invoke<CodexApprovalDto[]>('codex_approvals_list', { projectId })
}

export async function codexThreadCreate(projectId: string, title?: string) {
  return invoke<CodexThreadDto>('codex_thread_create', {
    input: { projectId, title },
  })
}

export async function codexTurnStart(projectId: string, threadId: string, prompt: string) {
  return invoke<unknown>('codex_turn_start', {
    input: { projectId, threadId, prompt },
  })
}

export async function codexServerRequestRespond(requestId: number, result: unknown = { approved: true }) {
  return invoke<void>('codex_server_request_respond', {
    input: { requestId, result },
  })
}

export async function codexServerRequestDeny(requestId: number, message?: string) {
  return invoke<void>('codex_server_request_deny', {
    input: { requestId, message },
  })
}

export async function browserTabsList(projectId?: string) {
  return invoke<BrowserTabDto[]>('browser_tabs_list', { projectId })
}

export async function browserTabCreate(projectId: string, url?: string, title?: string) {
  return invoke<BrowserTabDto>('browser_tab_create', {
    input: { projectId, url, title },
  })
}

export async function browserTabNavigate(tabId: string, url: string, title?: string) {
  return invoke<BrowserTabDto>('browser_tab_navigate', {
    input: { tabId, url, title },
  })
}

export async function browserTabBack(tabId: string) {
  return invoke<BrowserTabDto>('browser_tab_back', { tabId })
}

export async function browserTabForward(tabId: string) {
  return invoke<BrowserTabDto>('browser_tab_forward', { tabId })
}

export async function browserTabReload(tabId: string) {
  return invoke<BrowserTabDto>('browser_tab_reload', { tabId })
}

export async function browserTabClose(tabId: string) {
  return invoke<void>('browser_tab_close', { tabId })
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

export function listenTerminalEvents(handler: (payload: TerminalEventPayload) => void): Promise<UnlistenFn> {
  return listen<TerminalEventPayload>('app://terminal', (event: Event<TerminalEventPayload>) => {
    if (event.payload) handler(event.payload)
  })
}

export function listenCodexEvents(handler: (payload: CodexEventPayload) => void): Promise<UnlistenFn> {
  return listen<CodexEventPayload>('app://codex', (event: Event<CodexEventPayload>) => {
    if (event.payload) handler(event.payload)
  })
}

export function listenBrowserEvents(handler: (payload: BrowserEventPayload) => void): Promise<UnlistenFn> {
  return listen<BrowserEventPayload>('app://browser', (event: Event<BrowserEventPayload>) => {
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

export function toTerminalSession(dto: TerminalSessionRecordDto): TerminalSession {
  return {
    id: dto.sessionId,
    projectId: dto.projectId,
    title: dto.title,
    cwd: dto.cwd,
    shell: dto.shell,
    shellPath: dto.shellPath,
    cols: dto.cols,
    rows: dto.rows,
    isRunning: dto.isRunning,
    restoredFromPersistence: dto.restoredFromPersistence,
    scrollbackBytes: dto.scrollbackBytes,
    startupCommand: dto.startupCommand ?? undefined,
    lastExitReason: dto.lastExitReason ?? undefined,
  }
}

export function toCodexThread(dto: CodexThreadDto): CodexThread {
  return {
    id: dto.threadId,
    projectId: dto.projectId,
    title: dto.title ?? 'New Thread',
    lastMessage: dto.lastAssistantMessage ?? undefined,
    unread: dto.unread,
    status: normalizeCodexStatus(dto.status),
  }
}

export function toCodexApproval(dto: CodexApprovalDto): CodexApproval {
  return {
    id: String(dto.requestId),
    threadId: dto.threadId ?? '',
    projectId: dto.projectId,
    actionType: dto.actionType,
    category: dto.category,
    riskLevel: dto.riskLevel,
    policyAction: dto.policyAction,
    policyReason: dto.policyReason ?? undefined,
    description: dto.description,
    context: dto.contextJson ? JSON.stringify(dto.contextJson) : undefined,
  }
}

export function toBrowserTab(dto: BrowserTabDto): BrowserTab {
  return {
    id: dto.tabId,
    projectId: dto.projectId,
    title: dto.title,
    url: dto.url,
    isPinned: dto.isPinned,
    canGoBack: dto.canGoBack,
    canGoForward: dto.canGoForward,
    isLoading: dto.isLoading,
    faviconUrl: dto.faviconUrl ?? undefined,
    securityOrigin: dto.securityOrigin ?? undefined,
    isSecure: dto.isSecure,
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

function normalizeCodexStatus(status: string): CodexThread['status'] {
  if (
    status === 'idle' ||
    status === 'running' ||
    status === 'waiting_approval' ||
    status === 'waitingApproval' ||
    status === 'error' ||
    status === 'disconnected'
  ) {
    return status
  }
  return 'idle'
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
