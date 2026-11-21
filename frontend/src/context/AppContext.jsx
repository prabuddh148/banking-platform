import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import { listMyNotifications, markNotificationRead } from '../services/notificationService.js'

const AppContext = createContext(null)

// Holds the pieces of UI state shared across the app:
//  - role: which shell we're in ('customer' | 'admin'), derived from the URL
//  - notifications: so the topbar badge and the notifications page stay in sync
//  - a stack of toasts for actions like "Transfer submitted"
//  - open/closed state of the command palette (Ctrl+K) and the mobile nav drawer
export function AppProvider({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  const role = location.pathname.startsWith('/admin') ? 'admin' : 'customer'

  const [notifications, setNotifications] = useState([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState(null)
  const [toasts, setToasts] = useState([])
  const toastSeq = useRef(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const dismissToast = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  /**
   * showToast('Transfer submitted')                       -> success
   * showToast('Could not freeze', 'error')                -> error
   * showToast({ title, description, tone: 'info' })       -> richer toast
   */
  const showToast = useCallback((messageOrOptions, tone = 'success') => {
    const opts = typeof messageOrOptions === 'string' ? { title: messageOrOptions, tone } : { tone: 'success', ...messageOrOptions }
    const id = ++toastSeq.current
    setToasts((list) => [...list.slice(-3), { id, ...opts }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), opts.duration || 4200)
  }, [])

  // Close the mobile drawer whenever the route changes
  useEffect(() => setMobileNavOpen(false), [location.pathname])

  // Ctrl/Cmd + K opens the command palette from anywhere
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const refreshNotifications = useCallback(async () => {
    if (!user) return
    setNotificationsLoading(true)
    setNotificationsError(null)
    try {
      setNotifications(await listMyNotifications(user))
    } catch (err) {
      setNotificationsError(err)
    } finally {
      setNotificationsLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) refreshNotifications()
    else setNotifications([])
  }, [user, refreshNotifications])

  const markRead = useCallback((id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    markNotificationRead(id).catch(() => {
      // Not critical; keep it read locally.
    })
  }, [])

  const markAllRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read)
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    const results = await Promise.allSettled(unread.map((n) => markNotificationRead(n.id)))
    if (results.some((r) => r.status === 'rejected')) showToast('Some notifications could not be marked as read', 'error')
  }, [notifications, showToast])

  const unreadCount = notifications.filter((n) => !n.read).length

  const value = {
    role,
    notifications,
    notificationsLoading,
    notificationsError,
    refreshNotifications,
    unreadCount,
    markAllRead,
    markRead,
    toasts,
    showToast,
    dismissToast,
    paletteOpen,
    setPaletteOpen,
    mobileNavOpen,
    setMobileNavOpen,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
