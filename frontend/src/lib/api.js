// Thin fetch wrapper for the API gateway.
//
// Every backend response is wrapped in ApiResponse:
//   success -> { "data": ..., "success": true }
//   failure -> { "error": { "code", "message", "status", "details", "timestamp" } }
// request() unwraps `data` for you, or throws an ApiError carrying the backend's
// error code / HTTP status / field-level validation details.

import { API_BASE_URL } from './config.js'
import { getToken } from './session.js'

export class ApiError extends Error {
  constructor(message, { code = 'UNKNOWN_ERROR', status = 0, details = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

// AuthContext registers a callback here so a 401 anywhere logs the user out.
let unauthorizedHandler = null
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn
}

function buildUrl(path, query) {
  const url = `${API_BASE_URL}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.append(key, value)
  })
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

function fallbackMessage(status) {
  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 404) return 'The requested resource was not found.'
  if (status === 502 || status === 503 || status === 504) return 'The service is temporarily unavailable.'
  return `Request failed (HTTP ${status}).`
}

/**
 * @param {string} path    e.g. '/api/v1/accounts'
 * @param {object} options { method, body, query, headers, auth (default true), signal }
 * @returns the unwrapped `data` of the ApiResponse
 */
export async function request(path, { method = 'GET', body, query, headers = {}, auth = true, signal } = {}) {
  const finalHeaders = { Accept: 'application/json', ...headers }
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json'

  const token = auth ? getToken() : null
  if (token) finalHeaders.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new ApiError('Cannot reach the server. Is the API gateway running on http://localhost:8080?', {
      code: 'NETWORK_ERROR',
      status: 0,
    })
  }

  let payload = null
  const text = await response.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (response.status === 401 && token && unauthorizedHandler) {
    unauthorizedHandler()
  }

  if (!response.ok || payload?.error) {
    const err = payload?.error || {}
    throw new ApiError(err.message || fallbackMessage(response.status), {
      code: err.code || `HTTP_${response.status}`,
      status: err.status || response.status,
      details: err.details || null,
    })
  }

  if (payload && typeof payload === 'object' && 'data' in payload) return payload.data
  return payload
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
}

/** PagedResponse -> its `content` array (also tolerates a plain array). */
export function pageContent(page) {
  if (Array.isArray(page)) return page
  return Array.isArray(page?.content) ? page.content : []
}

/** Random key for the Idempotency-Key header, so a retried POST isn't applied twice. */
export function newIdempotencyKey() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {
    // fall through
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}
