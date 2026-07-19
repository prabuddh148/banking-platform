import { createContext, useContext, useState, useCallback } from 'react'
import { notifications as seedNotifications } from '../data/mockData.js'

const AppContext = createContext(null)

// Holds the pieces of UI state shared across the app:
//  - role: which shell we're in ('customer' | 'admin')
//  - notifications: so the topbar badge and the notifications page stay in sync
//  - a lightweight toast for actions like "Transfer submitted"
export function AppProvider({ children }) {
  const [role, setRole] = useState('customer')
  const [notifications, setNotifications] = useState(seedNotifications)
  const [toast, setToast] = useState(null)

  const toggleRole = useCallback(() => {
    setRole((r) => (r === 'customer' ? 'admin' : 'customer'))
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  const markRead = useCallback((id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }, [])

  const showToast = useCallback((message) => {
    setToast({ message, id: message + ':' + notifications.length })
    setTimeout(() => setToast(null), 3200)
  }, [notifications.length])

  const unreadCount = notifications.filter((n) => !n.read).length

  const value = {
    role,
    setRole,
    toggleRole,
    notifications,
    unreadCount,
    markAllRead,
    markRead,
    toast,
    showToast,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
