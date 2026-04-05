import { create } from 'zustand'

export type NotificationLevel = 'error' | 'info'

export interface AppNotification {
  id: string
  title: string
  message: string
  level: NotificationLevel
  createdAt: string
}

interface NotificationsState {
  notifications: AppNotification[]
  pushNotification: (input: Omit<AppNotification, 'id' | 'createdAt'>) => string
  pushError: (title: string, error: unknown, fallbackMessage?: string) => string
  dismissNotification: (id: string) => void
}

let notificationCounter = 0

export const useNotificationsStore = create<NotificationsState>((set) => ({
  notifications: [],

  pushNotification: (input) => {
    const id = `notice-${++notificationCounter}`
    const notification: AppNotification = {
      id,
      createdAt: new Date().toISOString(),
      ...input,
    }
    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, 5),
    }))
    return id
  },

  pushError: (title, error, fallbackMessage = 'Unexpected backend error') => {
    const message = error instanceof Error ? error.message : fallbackMessage
    const id = `notice-${++notificationCounter}`
    const notification: AppNotification = {
      id,
      title,
      message,
      level: 'error',
      createdAt: new Date().toISOString(),
    }
    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, 5),
    }))
    return id
  },

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((notification) => notification.id !== id),
    })),
}))
