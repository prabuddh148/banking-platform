// audit-service: /api/v1/audit (admin only)
import { api, pageContent } from '../lib/api.js'
import { API_V1, USE_MOCK } from '../lib/config.js'
import { detailsToText, humanize } from './mappers.js'
import * as adminMock from './mock/adminMock.js'

const BASE = `${API_V1}/audit`

/**
 * AuditLogResponse -> UI audit entry
 * { id, eventId, timestamp, service, actor, action (= eventType), entity, entityType, detail,
 *   details (object), severity, correlationId }
 */
export function mapAuditLog(dto) {
  // `action` is a readable sentence from AuditLogFormatter; older rows may hold an enum-like value
  const sentence = dto.action && dto.action !== dto.eventType
    ? (/\s/.test(dto.action) ? dto.action : humanize(dto.action))
    : ''
  const details = dto.details && typeof dto.details === 'object' ? dto.details : dto.details ? { detail: dto.details } : null
  return {
    id: dto.id,
    eventId: dto.eventId || null,
    timestamp: dto.occurredAt || dto.recordedAt,
    recordedAt: dto.recordedAt,
    service: dto.sourceService || 'unknown',
    actor: dto.actor || 'system',
    action: dto.eventType || dto.action,
    entity: dto.aggregateId || '—',
    entityType: dto.aggregateType,
    detail: sentence || detailsToText(dto.details),
    details,
    severity: dto.severity || 'INFO',
    correlationId: dto.correlationId,
  }
}

const byNewest = (a, b) => new Date(b.timestamp) - new Date(a.timestamp)

/**
 * Latest audit events (newest first). Filters map 1:1 to the backend query params:
 * eventType, severity, actor, from / to (ISO instants).
 */
export async function listAuditLogs({ eventType, severity, actor, from, to, size = 100 } = {}) {
  if (USE_MOCK) return adminMock.listAuditLogs({ eventType, severity, actor, from, to })
  const page = await api.get(`${BASE}/logs`, { query: { page: 0, size, eventType, severity, actor, from, to } })
  return pageContent(page).map(mapAuditLog).sort(byNewest)
}

/** Every event of one business flow, oldest first. */
export async function listCorrelatedLogs(correlationId) {
  if (USE_MOCK) return adminMock.auditByCorrelation(correlationId)
  const data = await api.get(`${BASE}/logs/correlation/${encodeURIComponent(correlationId)}`)
  return pageContent(data).map(mapAuditLog)
}

/** Everything about one account / transaction, oldest first. */
export async function listAggregateLogs(aggregateId) {
  if (USE_MOCK) return adminMock.auditByAggregate(aggregateId)
  const data = await api.get(`${BASE}/logs/aggregate/${encodeURIComponent(aggregateId)}`)
  return pageContent(data).map(mapAuditLog)
}
