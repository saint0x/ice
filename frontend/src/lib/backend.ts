import { invoke } from '@tauri-apps/api/core'
import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  BrowserTab,
  CodexApproval,
  CodexMessage,
  ProjectBrowserSidebarItem,
  ProjectCodexSidebarItem,
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

interface FileReadResultDto {
  path: string
  content?: string | null
  isBinary: boolean
  sizeBytes: number
  encoding?: string | null
  hasBom: boolean
  modifiedAtMs?: number | null
  versionToken?: string | null
}

interface GitStatusSummaryDto {
  branch?: string | null
  ahead: number
  behind: number
  changes: GitChange[]
}

interface GitCommitReadinessDto {
  authorName?: string | null
  authorEmail?: string | null
  authorConfigured: boolean
  commitMessageValid: boolean
  messageHint?: string | null
  blockingReason?: string | null
  hooksPath?: string | null
  activeHooks: string[]
}

interface GitDiffRecordDto {
  path: string
  staged: boolean
  diff: string
}

interface GitBranchRecordDto {
  name: string
  reference: string
  commit: string
  upstream?: string | null
  tracking?: string | null
  current: boolean
  isRemote: boolean
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
  message?: CodexMessageDto
}

interface CodexMessageDto {
  messageId: string
  projectId: string
  threadId: string
  turnId?: string | null
  role: string
  content: string
  state: string
  createdAt: string
  updatedAt: string
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

interface BrowserExternalOpenRequestDto {
  tabId: string
  projectId: string
  url: string
}

interface ProjectBrowserSidebarItemDto {
  tabId: string
  title: string
  url: string
  isPinned: boolean
  isLoading: boolean
  isSecure: boolean
}

interface ProjectCodexSidebarItemDto {
  threadId: string
  title: string
  status: string
  unread: boolean
  lastAssistantMessage?: string | null
}

export type BrowserRestorePolicy = 'none' | 'pinned' | 'all'

interface BrowserFindInPageResultDto {
  tabId: string
  query: string
  matches: number
  activeMatchOrdinal: number
  finalUpdate: boolean
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

export async function gitBranchesList(projectId: string) {
  return invoke<GitBranchRecordDto[]>('git_branches_list', { projectId })
}

export async function gitStagePaths(projectId: string, paths: string[]) {
  return invoke<GitStatusSummaryDto>('git_stage_paths', {
    input: { projectId, paths },
  })
}

export async function gitUnstagePaths(projectId: string, paths: string[]) {
  return invoke<GitStatusSummaryDto>('git_unstage_paths', {
    input: { projectId, paths },
  })
}

export async function gitRestorePaths(input: {
  projectId: string
  paths: string[]
  staged?: boolean
  worktree?: boolean
}) {
  return invoke<GitStatusSummaryDto>('git_restore_paths', { input })
}

export async function gitCommit(projectId: string, message: string) {
  return invoke<GitStatusSummaryDto>('git_commit', {
    input: { projectId, message },
  })
}

export async function gitBranchCheckout(input: {
  projectId: string
  branchName: string
  create?: boolean
  startPoint?: string
}) {
  return invoke<GitStatusSummaryDto>('git_branch_checkout', { input })
}

export async function gitFetch(projectId: string, remote?: string) {
  return invoke<GitStatusSummaryDto>('git_fetch', {
    input: { projectId, remote },
  })
}

export async function gitPull(input: { projectId: string; remote?: string; branch?: string }) {
  return invoke<GitStatusSummaryDto>('git_pull', { input })
}

export async function gitPush(input: {
  projectId: string
  remote?: string
  branch?: string
  setUpstream?: boolean
}) {
  return invoke<GitStatusSummaryDto>('git_push', { input })
}

export async function gitCommitReadiness(projectId: string, message?: string) {
  return invoke<GitCommitReadinessDto>('git_commit_readiness', {
    input: { projectId, message },
  })
}

export async function gitDiffRead(projectId: string, path: string, staged?: boolean) {
  return invoke<GitDiffRecordDto>('git_diff_read', {
    input: { projectId, path, staged },
  })
}

export async function gitDiffTreeRead(projectId: string, staged?: boolean) {
  return invoke<GitDiffRecordDto[]>('git_diff_tree_read', {
    input: { projectId, staged },
  })
}

export async function fileRead(projectId: string, path: string) {
  return invoke<FileReadResultDto>('file_read', {
    input: { projectId, path },
  })
}

export async function fileWriteText(input: {
  projectId: string
  path: string
  content: string
  expectedVersionToken?: string
  encoding?: string
  hasBom?: boolean
}) {
  return invoke<void>('file_write_text', { input })
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

export async function terminalResize(sessionId: string, cols: number, rows: number) {
  return invoke<void>('terminal_resize', {
    input: { sessionId, cols, rows },
  })
}

export async function terminalRename(sessionId: string, title: string) {
  return invoke<TerminalSessionRecordDto>('terminal_rename', {
    input: { sessionId, title },
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

export async function codexThreadMessagesList(threadId: string) {
  return invoke<CodexMessageDto[]>('codex_thread_messages_list', {
    input: { threadId },
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

export async function projectBrowserRestorePolicyGet(projectId: string) {
  return invoke<BrowserRestorePolicy>('project_browser_restore_policy_get', { projectId })
}

export async function projectBrowserRestorePolicySet(projectId: string, policy: BrowserRestorePolicy) {
  return invoke<BrowserRestorePolicy>('project_browser_restore_policy_set', {
    input: { projectId, policy },
  })
}

export async function projectBrowserSidebar(projectId: string) {
  return invoke<ProjectBrowserSidebarItemDto[]>('project_browser_sidebar', { projectId })
}

export async function projectCodexSidebar(projectId: string) {
  return invoke<ProjectCodexSidebarItemDto[]>('project_codex_sidebar', { projectId })
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

export async function browserTabPinSet(tabId: string, isPinned: boolean) {
  return invoke<BrowserTabDto>('browser_tab_pin_set', {
    input: { tabId, isPinned },
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

export async function browserRendererAttach(tabId: string, rendererId: string, paneId?: string) {
  return invoke('browser_renderer_attach', {
    input: { tabId, rendererId, paneId },
  })
}

export async function browserRendererBoundsSet(
  tabId: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return invoke('browser_renderer_bounds_set', {
    input: { tabId, x, y, width, height },
  })
}

export async function browserRendererDetach(tabId: string) {
  return invoke<void>('browser_renderer_detach', { tabId })
}

export async function browserTabRendererStateSet(input: {
  tabId: string
  url?: string
  title?: string
  isLoading?: boolean
  faviconUrl?: string | null
  securityOrigin?: string | null
  isSecure?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
}) {
  return invoke<BrowserTabDto>('browser_tab_renderer_state_set', { input })
}

export async function browserTabOpenExternal(tabId: string) {
  return invoke<BrowserExternalOpenRequestDto>('browser_tab_open_external', { tabId })
}

export async function browserFindInPage(input: {
  tabId: string
  query: string
  forward?: boolean
  findNext?: boolean
}) {
  return invoke<void>('browser_find_in_page', { input })
}

export async function browserFindInPageReport(input: {
  tabId: string
  query: string
  matches: number
  activeMatchOrdinal: number
  finalUpdate?: boolean
}) {
  return invoke<BrowserFindInPageResultDto>('browser_find_in_page_report', { input })
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

export function toCodexMessage(dto: CodexMessageDto): CodexMessage {
  return {
    id: dto.messageId,
    threadId: dto.threadId,
    projectId: dto.projectId,
    turnId: dto.turnId ?? undefined,
    role: normalizeCodexRole(dto.role),
    content: dto.content,
    state: dto.state === 'streaming' ? 'streaming' : 'complete',
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
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

export function toProjectBrowserSidebarItem(dto: ProjectBrowserSidebarItemDto): ProjectBrowserSidebarItem {
  return {
    tabId: dto.tabId,
    title: dto.title,
    url: dto.url,
    isPinned: dto.isPinned,
    isLoading: dto.isLoading,
    isSecure: dto.isSecure,
  }
}

export function toProjectCodexSidebarItem(dto: ProjectCodexSidebarItemDto): ProjectCodexSidebarItem {
  return {
    threadId: dto.threadId,
    title: dto.title,
    status: normalizeCodexStatus(dto.status),
    unread: dto.unread,
    lastAssistantMessage: dto.lastAssistantMessage ?? undefined,
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

function normalizeCodexRole(role: string): CodexMessage['role'] {
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role
  }
  return 'assistant'
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
