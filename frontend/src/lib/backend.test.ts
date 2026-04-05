import { describe, expect, it } from 'vitest'
import { toBrowserRuntimeNotice, toGitMutationEvent } from '@/lib/backend'

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
})
