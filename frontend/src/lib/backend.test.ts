import { describe, expect, it } from 'vitest'
import {
  toBrowserRuntimeNotice,
  toCodexRuntimeError,
  toCodexThread,
  toGitMutationEvent,
  toProjectCodexSidebarItem,
  toTerminalRuntimeError,
} from '@/lib/backend'

describe('backend mappers', () => {
  it('maps browser download completion notices', () => {
    const notice = toBrowserRuntimeNotice({
      type: 'downloadFinished',
      request: {
        tabId: 'tab-1',
        projectId: 'project-1',
        url: 'https://example.com/archive.zip',
        destinationPath: '/tmp/archive.zip',
        completed: true,
        success: true,
      },
    })

    expect(notice).toBeTruthy()
    expect(notice?.kind).toBe('downloadFinished')
    expect(notice?.projectId).toBe('project-1')
    expect(notice?.message).toContain('/tmp/archive.zip')
  })

  it('maps browser persistence failures to runtime notices', () => {
    const notice = toBrowserRuntimeNotice({
      type: 'persistenceFailed',
      tabId: 'tab-1',
      projectId: 'project-1',
      message: 'Browser history was not saved: disk full',
    })

    expect(notice).toBeTruthy()
    expect(notice?.kind).toBe('persistenceFailed')
    expect(notice?.projectId).toBe('project-1')
    expect(notice?.message).toBe('Browser history was not saved: disk full')
  })

  it('does not manufacture browser persistence notices without a project id', () => {
    expect(toBrowserRuntimeNotice({
      type: 'persistenceFailed',
      tabId: 'tab-1',
      message: 'Browser history was not saved: disk full',
    })).toBeNull()
    expect(toBrowserRuntimeNotice({
      type: 'persistenceFailed',
      tabId: 'tab-1',
      projectId: '   ',
      message: 'Browser history was not saved: disk full',
    })).toBeNull()
  })

  it('maps terminal persistence failures to runtime errors', () => {
    const error = toTerminalRuntimeError({
      type: 'persistenceFailed',
      sessionId: 'terminal-1',
      projectId: 'project-1',
      message: 'Terminal scrollback was not saved: disk full',
    })

    expect(error).toEqual({
      title: 'Terminal persistence failed',
      message: 'Terminal scrollback was not saved: disk full',
    })
  })

  it('maps Codex persistence failures to runtime errors', () => {
    const error = toCodexRuntimeError({
      type: 'persistenceFailed',
      threadId: 'thread-1',
      projectId: 'project-1',
      errorMessage: 'Codex message was not saved: disk full',
    })

    expect(error).toEqual({
      title: 'Codex persistence failed',
      message: 'Codex message was not saved: disk full',
    })
  })

  it('maps structured git mutation events', () => {
    const event = toGitMutationEvent({
      type: 'mutationCompleted',
      projectId: 'project-1',
      action: 'push',
      context: { branch: 'main', setUpstream: true },
      summary: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        changes: [],
      },
    })

    expect(event).toBeTruthy()
    expect(event?.action).toBe('push')
    expect(event?.summary.branch).toBe('main')
    expect(event?.context.setUpstream).toBe(true)
  })

  it('preserves canonical Codex status from backend DTOs', () => {
    const thread = toCodexThread({
      threadId: 'thread-1',
      projectId: 'project-1',
      title: 'Review',
      status: 'waitingApproval',
      lastAssistantMessage: 'Need approval',
      unread: true,
    })
    const sidebarItem = toProjectCodexSidebarItem({
      threadId: 'thread-1',
      title: 'Review',
      status: 'waitingApproval',
      unread: true,
      lastAssistantMessage: 'Need approval',
    })

    expect(thread.status).toBe('waitingApproval')
    expect(sidebarItem.status).toBe('waitingApproval')
  })
})
