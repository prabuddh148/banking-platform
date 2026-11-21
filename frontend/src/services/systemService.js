// api-gateway: GET /api/v1/system/health (admin) — aggregated /actuator/health of every service.
import { api } from '../lib/api.js'
import { API_V1, USE_MOCK } from '../lib/config.js'
import { toNumber } from './mappers.js'
import * as adminMock from './mock/adminMock.js'

// Spring Boot health status -> UI label used by StatusBadge.
function statusLabel(status) {
  const s = String(status || '').toUpperCase()
  if (s === 'UP' || s === 'OPERATIONAL') return 'Operational'
  if (s === 'DOWN' || s === 'OUT_OF_SERVICE') return 'Down'
  if (s === 'DEGRADED') return 'Degraded'
  if (s === '') return 'Unknown'
  return s.charAt(0) + s.slice(1).toLowerCase()
}

function portOf(url) {
  const m = /:(\d{2,5})(?:\/|$)/.exec(String(url || ''))
  return m ? Number(m[1]) : null
}

function mapService(name, value) {
  const v = value && typeof value === 'object' ? value : { status: value }
  return {
    name: v.name || v.service || v.serviceName || name,
    status: statusLabel(v.status),
    latencyMs: toNumber(v.latencyMs ?? v.responseTimeMs ?? v.durationMs),
    uptime: toNumber(v.uptime),
    version: v.version || null,
    instances: toNumber(v.instances),
    url: v.url || v.uri || null,
    port: toNumber(v.port) ?? portOf(v.url || v.uri),
    history: Array.isArray(v.history) ? v.history : null,
    error: v.error || v.message || null,
  }
}

/**
 * The exact response body is defined by the gateway; accept the common shapes:
 *   { status, services: [ { name, status, ... } ] }
 *   { status, services: { "account-service": "UP" | { status, ... } } }
 *   { status, components: { ... } }   (actuator-like)
 *   [ { name, status } ]
 * -> { status: 'Operational'|'Degraded'|'Down', services: [...] }
 */
export function mapHealth(data) {
  let entries = []
  const list = Array.isArray(data) ? data : data?.services ?? data?.components ?? null
  if (Array.isArray(list)) entries = list.map((s, i) => mapService(`service-${i + 1}`, s))
  else if (list && typeof list === 'object') entries = Object.entries(list).map(([k, v]) => mapService(k, v))

  const anyDown = entries.some((s) => s.status === 'Down')
  const allUp = entries.length > 0 && entries.every((s) => s.status === 'Operational')
  const overall = data?.status ? statusLabel(data.status) : allUp ? 'Operational' : anyDown ? 'Degraded' : 'Unknown'
  return { status: overall, services: entries, checkedAt: data?.timestamp || data?.checkedAt || new Date().toISOString() }
}

export async function getSystemHealth() {
  if (USE_MOCK) return mapHealth(await adminMock.getSystemHealth())
  return mapHealth(await api.get(`${API_V1}/system/health`))
}
