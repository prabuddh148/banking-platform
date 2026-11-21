// Keeps the logged-in session ({ token, user, expiresAt }).
//
// The session lives in memory and is mirrored to sessionStorage so a page
// refresh keeps you logged in (but closing the tab logs you out). Storage can
// be unavailable (private mode, blocked site data), so every access is wrapped
// in try/catch and the in-memory copy keeps working regardless.

const KEY = 'meridian.session'

let current = null

function isExpired(session) {
  return Boolean(session?.expiresAt) && Date.now() >= session.expiresAt
}

export function loadSession() {
  if (current && !isExpired(current)) return current
  current = null
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.token || isExpired(parsed)) {
      sessionStorage.removeItem(KEY)
      return null
    }
    current = parsed
    return current
  } catch {
    return null
  }
}

export function saveSession(session) {
  current = session
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    // Storage unavailable: the in-memory session still works for this page load.
  }
}

export function clearSession() {
  current = null
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

export function getToken() {
  return loadSession()?.token || null
}
