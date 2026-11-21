// Live platform events for the admin console.
//
// Mock mode: a simulated Kafka cluster (mock/adminMock.js) streams whole sagas with real
// topic names, partitions and offsets.
// Real mode: there is no browser-facing Kafka endpoint, so we poll audit-service
// (GET /api/v1/audit/logs, which records every event) and render each row as an event.
import { USE_MOCK } from '../lib/config.js'
import { listAuditLogs, listCorrelatedLogs } from './auditService.js'
import * as adminMock from './mock/adminMock.js'
import { topicOf, severityOf } from './eventCatalog.js'

export * from './eventCatalog.js'

export const POLL_INTERVAL_MS = 5000
export const IS_SIMULATED = USE_MOCK

/**
 * Audit row -> BaseEvent-shaped UI event
 * { eventId, eventType, aggregateId, occurredAt, correlationId, source, schemaVersion, payload,
 *   topic, partition, offset, key, severity }
 */
export function auditToEvent(log) {
  const payload = log.details && typeof log.details === 'object' ? { ...log.details } : log.detail ? { detail: log.detail } : {}
  return {
    eventId: log.eventId || String(log.id),
    eventType: log.action,
    aggregateId: log.entity,
    occurredAt: log.timestamp,
    correlationId: log.correlationId || null,
    source: log.service,
    schemaVersion: 1,
    payload,
    topic: topicOf(log.action),
    partition: null, // not exposed by audit-service
    offset: null,
    key: log.entity,
    severity: log.severity || severityOf(log.action, payload),
    actor: log.actor,
    summary: log.detail,
  }
}

/**
 * Starts streaming events. onEvents(events[]) gets new events (newest last or any order:
 * callers sort). `backfill` asks for recent history first. Returns an unsubscribe function
 * that stops every timer.
 */
export function subscribeToEvents(onEvents, { onError, onStatus, backfill = 60, intervalMs = POLL_INTERVAL_MS } = {}) {
  if (USE_MOCK) {
    onStatus?.('live')
    return adminMock.subscribeEvents(onEvents, { backfill })
  }

  let stopped = false
  let timer = null
  const seen = new Set()
  let first = true

  async function poll() {
    try {
      const logs = await listAuditLogs({ size: first ? Math.max(backfill, 20) : 50 })
      first = false
      const fresh = logs.filter((l) => {
        const id = l.eventId || l.id
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
      if (!stopped) {
        onStatus?.('live')
        if (fresh.length) onEvents(fresh.map(auditToEvent))
      }
    } catch (err) {
      if (!stopped) {
        onStatus?.('error')
        onError?.(err)
      }
    } finally {
      if (!stopped) timer = setTimeout(poll, intervalMs)
    }
  }
  poll()

  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

/** All events of one saga / business flow, oldest first. */
export async function getCorrelatedEvents(correlationId) {
  if (USE_MOCK) {
    const events = await adminMock.eventsByCorrelation(correlationId)
    if (events) return events
  }
  const logs = await listCorrelatedLogs(correlationId)
  return logs.map(auditToEvent)
}
