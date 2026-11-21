// Kafka topics and event types of the platform (README §9), shared by the event
// service, the mock generator and the admin UI. Pure data + helpers, no I/O.

export const TOPICS = [
  { id: 'banking.account.events', short: 'account', label: 'Account', producer: 'account-service', partitions: 3 },
  { id: 'banking.transaction.events', short: 'transaction', label: 'Transaction', producer: 'transaction-service', partitions: 3 },
  { id: 'banking.fraud.events', short: 'fraud', label: 'Fraud', producer: 'fraud-service', partitions: 3 },
  { id: 'banking.notification.events', short: 'notification', label: 'Notification', producer: 'any service', partitions: 3 },
]

const [ACCOUNT, TRANSACTION, FRAUD, NOTIFICATION] = TOPICS.map((t) => t.id)

/** eventType -> { topic, source (default producer), aggregateType } */
export const EVENT_TYPES = {
  ACCOUNT_CREATED: { topic: ACCOUNT, source: 'account-service', aggregateType: 'ACCOUNT' },
  ACCOUNT_STATUS_CHANGED: { topic: ACCOUNT, source: 'account-service', aggregateType: 'ACCOUNT' },
  BALANCE_UPDATED: { topic: ACCOUNT, source: 'account-service', aggregateType: 'TRANSACTION' },
  BALANCE_UPDATE_FAILED: { topic: ACCOUNT, source: 'account-service', aggregateType: 'TRANSACTION' },
  TRANSACTION_INITIATED: { topic: TRANSACTION, source: 'transaction-service', aggregateType: 'TRANSACTION' },
  BALANCE_UPDATE_REQUESTED: { topic: TRANSACTION, source: 'transaction-service', aggregateType: 'TRANSACTION' },
  TRANSACTION_COMPLETED: { topic: TRANSACTION, source: 'transaction-service', aggregateType: 'TRANSACTION' },
  TRANSACTION_FAILED: { topic: TRANSACTION, source: 'transaction-service', aggregateType: 'TRANSACTION' },
  FRAUD_CLEARED: { topic: FRAUD, source: 'fraud-service', aggregateType: 'FRAUD' },
  FRAUD_DETECTED: { topic: FRAUD, source: 'fraud-service', aggregateType: 'FRAUD' },
  NOTIFICATION_REQUESTED: { topic: NOTIFICATION, source: 'notification-service', aggregateType: 'NOTIFICATION' },
}

export const EVENT_TYPE_NAMES = Object.keys(EVENT_TYPES)

export const BASE_EVENT_FIELDS = ['eventId', 'eventType', 'aggregateId', 'occurredAt', 'correlationId', 'source', 'schemaVersion']

export const SERVICE_NAMES = ['api-gateway', 'account-service', 'transaction-service', 'fraud-service', 'notification-service', 'audit-service']

export function topicOf(eventType) {
  return EVENT_TYPES[eventType]?.topic || null
}

export function topicMeta(topicId) {
  return TOPICS.find((t) => t.id === topicId) || null
}

/** Same rules as audit-service (README §14). */
export function severityOf(eventType, payload = {}) {
  if (eventType === 'FRAUD_DETECTED') return payload?.decision === 'BLOCK' ? 'CRITICAL' : 'WARNING'
  if (['TRANSACTION_FAILED', 'BALANCE_UPDATE_FAILED', 'ACCOUNT_STATUS_CHANGED'].includes(eventType)) return 'WARNING'
  return 'INFO'
}

/** Actor = first non-blank of initiatedBy, changedBy, reviewedBy, customerId, else "system". */
export function actorOf(payload = {}) {
  return payload.initiatedBy || payload.changedBy || payload.reviewedBy || payload.customerId || 'system'
}

/** Kafka uses murmur2(key) % partitions; a simple stable hash is close enough for the demo. */
export function partitionFor(key, partitions = 3) {
  const s = String(key || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % partitions
}

const inr = (v) => (v === null || v === undefined ? '' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)

/** One readable line for feeds and audit rows. */
export function summarizeEvent(type, p = {}) {
  switch (type) {
    case 'TRANSACTION_INITIATED':
      return `${p.transactionType || 'Transaction'} of ${inr(p.amount)} initiated by ${p.initiatedBy || 'customer'}${p.clientCountry && p.clientCountry !== 'IN' ? ` from ${p.clientCountry}` : ''}`
    case 'FRAUD_CLEARED':
      return `Risk ${p.riskScore ?? 0} (${p.riskLevel || 'LOW'}) · APPROVE${p.reviewedBy ? ` · reviewed by ${p.reviewedBy}` : ''}`
    case 'FRAUD_DETECTED':
      return `Risk ${p.riskScore} (${p.riskLevel}) · ${p.decision}${p.triggeredRules?.length ? ` · ${p.triggeredRules.join(', ')}` : ''}`
    case 'BALANCE_UPDATE_REQUESTED':
      return `Debit/credit of ${inr(p.amount)} requested`
    case 'BALANCE_UPDATED':
      return `Balances updated atomically · ${inr(p.amount)}`
    case 'BALANCE_UPDATE_FAILED':
      return `${p.errorCode || 'FAILED'} · ${p.reason || 'Balance update rejected'}`
    case 'TRANSACTION_COMPLETED':
      return `${p.transactionType || 'Transaction'} of ${inr(p.amount)} completed`
    case 'TRANSACTION_FAILED':
      return `${p.failureCode || 'FAILED'} · ${p.failureReason || 'Transaction failed'}`
    case 'ACCOUNT_CREATED':
      return `${(p.accountType || 'SAVINGS').replace('_', ' ')} account opened for ${p.customerName || p.customerId} with ${inr(p.initialBalance)}`
    case 'ACCOUNT_STATUS_CHANGED':
      return `${p.previousStatus} → ${p.newStatus}${p.reason ? ` · ${p.reason}` : ''}`
    case 'NOTIFICATION_REQUESTED':
      return `${p.channel || 'EMAIL'} to ${p.recipientId}: ${p.subject || p.notificationType || 'notification'}`
    default:
      return p.detail || type
  }
}

/** Mask PII like audit-service does (fields containing email / phone / accountNumber). */
export function maskDetails(payload = {}) {
  const out = {}
  Object.entries(payload).forEach(([k, v]) => {
    const key = k.toLowerCase()
    if (typeof v === 'string' && (key.includes('email') || key.includes('phone') || key.includes('accountnumber'))) {
      out[k] = v.length > 4 ? `${'*'.repeat(Math.min(9, v.length - 4))}${v.slice(-4)}` : '****'
    } else out[k] = v
  })
  return out
}
