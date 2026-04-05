import { memo, useEffect } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'
import { useNotificationsStore } from '@/stores/notifications'
import styles from './ToastViewport.module.css'

const TOAST_LIFETIME_MS = 6000

export const ToastViewport = memo(function ToastViewport() {
  const notifications = useNotificationsStore((state) => state.notifications)
  const dismissNotification = useNotificationsStore((state) => state.dismissNotification)

  useEffect(() => {
    if (notifications.length === 0) return
    const timers = notifications.map((notification) => window.setTimeout(() => {
      useNotificationsStore.getState().dismissNotification(notification.id)
    }, TOAST_LIFETIME_MS))
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
  }, [notifications])

  if (notifications.length === 0) return null

  return (
    <div className={styles.viewport} aria-live="polite" aria-atomic="false">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`${styles.toast} ${notification.level === 'error' ? styles.error : styles.info}`}
        >
          <div className={styles.iconWrap}>
            {notification.level === 'error' ? <AlertTriangle size={14} /> : <Info size={14} />}
          </div>
          <div className={styles.copy}>
            <div className={styles.title}>{notification.title}</div>
            <div className={styles.message}>{notification.message}</div>
          </div>
          <button
            className={styles.dismiss}
            onClick={() => dismissNotification(notification.id)}
            aria-label="Dismiss notification"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
})
