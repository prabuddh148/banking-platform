// audit-service: /api/v1/audit (admin only)
import { api, pageContent } from '../lib/api.js'
import { API_V1, USE_MOCK } from '../lib/config.js'
import { detailsToText, humanize } from './mappers.js'
import * as mock from './mock/mockStore.js'

const BASE = `${API_V1}/audit`

/**
 * AuditLogResponse -> UI audit entry
 * { id, timestamp, service, actor, action, entity, detail, severity, correlationId }
 */
export function mapAuditLog(dto) {
  return {
    id: dto.id,
    timestamp: dto.occurredAt || dto.recordedAt,
    service: dto.sourceService || 'unknown',
    actor: dto.actor || 'system',
    action: dto.eventType || dto.action,
    entity: dto.aggregateId || '—',
    entityType: dto.aggregateType,
    detail: dto.action && dto.action !== dto.eventType
      ? [humanize(dto.action), detailsToText(dto.details)].filter(Boolean).join(' — ')
      : detailsToText(dto.details),
    severity: dto.severity || 'INFO',
    correlationId: dto.correlationId,
  }
}

/** Latest audit events (newest first). Filters map 1:1 to the backend query params. */
export async function listAuditLogs({ eventType, severity, actor, size = 100 } = {}) {
  if (USE_MOCK) return mock.listAuditLogs()
  const page = await api.get(`${BASE}/logs`, { query: { page: 0, size, eventType, severity, actor } })
  return pageContent(page)
    .map(mapAuditLog)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
}
