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

export interface TerminalSession {
  id: TerminalId
  projectId: ProjectId
  title: string
  cwd: string
}

export interface CodexThread {
  id: ThreadId
  projectId: ProjectId
  title: string
  lastMessage?: string
  unread: boolean
  status: 'idle' | 'running' | 'waiting_approval'
}

export interface CodexApproval {
  id: string
  threadId: ThreadId
  projectId: ProjectId
  actionType: string
  description: string
  context?: string
}
