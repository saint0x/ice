import { beforeEach, describe, expect, it, vi } from 'vitest'
import { terminalCreate } from '@/lib/backend'
import { createAndFocusTerminalSession } from '@/lib/terminalSessions'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'

vi.mock('@/lib/backend', () => ({
  terminalCreate: vi.fn(),
  toTerminalSession: (dto: {
    sessionId: string
    projectId: string
    title: string
    cwd: string
    shell: string
    shellPath: string
    cols: number
    rows: number
    isRunning: boolean
    restoredFromPersistence: boolean
    scrollbackBytes: number
    startupCommand?: string | null
    lastExitReason?: string | null
  }) => ({
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
  }),
}))

const terminalRecord = {
  sessionId: 'terminal-1',
  projectId: 'project-1',
  title: 'zsh',
  cwd: '/tmp/project',
  shell: 'zsh',
  shellPath: '/bin/zsh',
  cols: 80,
  rows: 24,
  isRunning: true,
  restoredFromPersistence: false,
  scrollbackBytes: 0,
  startupCommand: null,
  lastExitReason: null,
}

function resetStores() {
  useProjectsStore.setState({
    projects: new Map(),
    projectOrder: [],
    activeProjectId: null,
  })
  useTerminalStore.setState({
    sessions: new Map(),
    activeSessionId: new Map(),
    scrollback: new Map(),
    diagnostics: new Map(),
  })
  useWorkspaceStore.setState({
    bottomDockOpen: false,
  })
  vi.mocked(terminalCreate).mockReset()
}

describe('createAndFocusTerminalSession', () => {
  beforeEach(() => {
    resetStores()
  })

  it('opens the dock and activates the created backend terminal session', async () => {
    vi.mocked(terminalCreate).mockResolvedValue(terminalRecord)

    const created = await createAndFocusTerminalSession('project-1')

    expect(terminalCreate).toHaveBeenCalledWith('project-1')
    expect(created.id).toBe('terminal-1')
    expect(useWorkspaceStore.getState().bottomDockOpen).toBe(true)
    expect(useTerminalStore.getState().sessions.get('terminal-1')).toEqual(created)
    expect(useTerminalStore.getState().activeSessionId.get('project-1')).toBe('terminal-1')
  })

  it('does not open an empty dock or add local state when backend creation fails', async () => {
    vi.mocked(terminalCreate).mockRejectedValue(new Error('pty unavailable'))

    await expect(createAndFocusTerminalSession('project-1')).rejects.toThrow('pty unavailable')

    expect(useWorkspaceStore.getState().bottomDockOpen).toBe(false)
    expect(useTerminalStore.getState().sessions.size).toBe(0)
    expect(useTerminalStore.getState().activeSessionId.size).toBe(0)
  })
})
