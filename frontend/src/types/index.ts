export type ProjectId = string
export type PaneId = string
export type TabId = string
export type TerminalId = string
export type ThreadId = string

export type ContentType = 'editor' | 'browser' | 'terminal' | 'git' | 'codex' | 'settings'

export type SidebarSection = 'files' | 'git' | 'browser' | 'terminal' | 'codex'

export type SplitDirection = 'horizontal' | 'vertical'

export type DockPosition = 'bottom'

export interface Project {
  id: ProjectId
  name: string
  path: string
  color: string
  branch: string
  collapsed: boolean
  expandedSections: Set<SidebarSection>
}

export interface Tab {
  id: TabId
  projectId: ProjectId
  type: ContentType
  title: string
  icon?: string
  dirty?: boolean
  pinned?: boolean
  meta?: Record<string, unknown>
}

export interface PaneNode {
  id: PaneId
  type: 'leaf'
  tabs: TabId[]
  activeTabId: TabId | null
}

export interface PaneSplit {
  id: string
  type: 'split'
  direction: SplitDirection
  children: PaneLayout[]
  ratio: number
}

export type PaneLayout = PaneNode | PaneSplit

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  children?: FileEntry[]
  expanded?: boolean
  depth: number
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict'
}

export interface GitChange {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict'
  staged: boolean
}

export interface GitState {
  branch: string
  changes: GitChange[]
  ahead: number
  behind: number
}

export type GitMutationAction =
  | 'stage'
  | 'unstage'
  | 'restore'
  | 'commit'
  | 'checkout'
  | 'fetch'
  | 'pull'
  | 'push'

export interface GitMutationContext {
  paths?: string[]
  staged?: boolean
  worktree?: boolean
  branchName?: string
  createdBranch?: boolean
  startPoint?: string
  remote?: string
  branch?: string
  setUpstream?: boolean
  commitMessage?: string
}

export interface GitMutationEvent {
  type: 'mutationCompleted'
  projectId: ProjectId
  action: GitMutationAction
  context: GitMutationContext
  summary: GitState
  receivedAt: string
}

export interface BrowserTab {
  id: string
  projectId: ProjectId
  title: string
  url: string
  isPinned: boolean
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  faviconUrl?: string
  securityOrigin?: string
  isSecure: boolean
}

export type BrowserRuntimeNoticeKind =
  | 'findResult'
  | 'downloadRequested'
  | 'downloadFinished'
  | 'openExternalRequested'
  | 'rendererAttached'
  | 'rendererDetached'

export interface BrowserRuntimeNotice {
  id: string
  projectId: ProjectId
  tabId: string
  kind: BrowserRuntimeNoticeKind
  message: string
  createdAt: string
}

export interface ProjectBrowserSidebarItem {
  tabId: string
  title: string
  url: string
  isPinned: boolean
  isLoading: boolean
  isSecure: boolean
}

export interface TerminalSession {
  id: TerminalId
  projectId: ProjectId
  title: string
  cwd: string
  shell?: string
  shellPath?: string
  cols?: number
  rows?: number
  isRunning?: boolean
  restoredFromPersistence?: boolean
  scrollbackBytes?: number
  startupCommand?: string
  lastExitReason?: string
}

export interface TerminalDiagnostics {
  sessionId: TerminalId
  projectId: ProjectId
  cwd: string
  shell: string
  shellPath: string
  title: string
  isRunning: boolean
  startupCommand?: string
  envOverrides?: Record<string, string>
  restoredFromPersistence: boolean
  lastExitCode?: number
  lastExitSignal?: string
  lastExitReason?: string
  scrollbackBytes: number
  scrollbackLineCount: number
  recentLines: string[]
}

export interface CodexThread {
  id: ThreadId
  projectId: ProjectId
  title: string
  lastMessage?: string
  unread: boolean
  status: 'idle' | 'running' | 'waiting_approval' | 'waitingApproval' | 'error' | 'disconnected'
}

export interface ProjectCodexSidebarItem {
  threadId: ThreadId
  title: string
  status: CodexThread['status']
  unread: boolean
  lastAssistantMessage?: string
}

export interface CodexMessage {
  id: string
  threadId: ThreadId
  projectId: ProjectId
  turnId?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  state: 'streaming' | 'complete'
  createdAt: string
  updatedAt: string
}

export interface CodexApproval {
  id: string
  threadId: ThreadId
  projectId: ProjectId
  actionType: string
  category?: string
  riskLevel?: string
  policyAction?: string
  policyReason?: string
  description: string
  context?: unknown
}
