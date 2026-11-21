import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { login as loginRequest } from '../services/authService.js'
import { loadSession, saveSession, clearSession } from '../lib/session.js'
import { setUnauthorizedHandler } from '../lib/api.js'
import { hasRole } from '../services/mappers.js'

const AuthContext = createContext(null)

// Holds the logged-in user + JWT. The token is attached to every API call by
// lib/api.js (it reads it from lib/session.js). Any 401 response logs out.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => loadSession())
  const [sessionExpired, setSessionExpired] = useState(false)

  const logout = useCallback(() => {
    clearSession()
    setSession(null)
  }, [])

  const login = useCallback(async (username, password) => {
    const next = await loginRequest(username, password)
    saveSession(next)
    setSession(next)
    setSessionExpired(false)
    return next.user
  }, [])

  // 401 from any API call -> token is invalid/expired -> back to the login page.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession()
      setSession(null)
      setSessionExpired(true)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  // Log out automatically when the token's lifetime runs out.
  useEffect(() => {
    if (!session?.expiresAt) return undefined
    const ms = session.expiresAt - Date.now()
    if (ms <= 0) {
      logout()
      return undefined
    }
    const timer = setTimeout(() => {
      logout()
      setSessionExpired(true)
    }, Math.min(ms, 2147483647))
    return () => clearTimeout(timer)
  }, [session, logout])

  const value = useMemo(() => {
    const user = session?.user || null
    return {
      user,
      token: session?.token || null,
      isAuthenticated: Boolean(user),
      isAdmin: hasRole(user, 'ROLE_ADMIN'),
      sessionExpired,
      login,
      logout,
    }
  }, [session, sessionExpired, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
