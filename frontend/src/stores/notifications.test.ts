import { beforeEach, describe, expect, it } from 'vitest'
import { useNotificationsStore } from '@/stores/notifications'

describe('notifications store', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ notifications: [] })
  })

  it('pushes and dismisses shell notifications', () => {
    const id = useNotificationsStore.getState().pushError('Terminal launch failed', new Error('spawn failed'))
    expect(useNotificationsStore.getState().notifications).toHaveLength(1)
    expect(useNotificationsStore.getState().notifications[0]?.message).toBe('spawn failed')

    useNotificationsStore.getState().dismissNotification(id)
    expect(useNotificationsStore.getState().notifications).toHaveLength(0)
  })
})
