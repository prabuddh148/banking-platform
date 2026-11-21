// Mock backend for the admin console (only used when VITE_USE_MOCK=true).
//
//  - A Kafka simulator that plays whole sagas (TRANSACTION_INITIATED -> FRAUD_* ->
//    BALANCE_UPDATE_REQUESTED -> BALANCE_UPDATED/FAILED -> TRANSACTION_COMPLETED/FAILED,
//    plus ACCOUNT_* and NOTIFICATION_REQUESTED) on the real topics, with per-partition
//    offsets, key = aggregateId and one correlationId per saga.
//  - Platform-wide transactions and audit rows derived from the same sagas, so the
//    transaction monitor, audit log and event stream all tell one consistent story.
//  - Jittered service health with latency history, dashboard series and fraud stats.
import * as seed from '../../data/mockData.js'
import { db, clone, delay } from './mockStore.js'
import {
  EVENT_TYPES, TOPICS, topicOf, severityOf, partitionFor, summarizeEvent, actorOf, maskDetails,
} from '../eventCatalog.js'

// ---------------------------------------------------------------- helpers
const rnd = Math.random
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const between = (min, max) => Math.round((min + rnd() * (max - min)) * 100) / 100
const chance = (p) => rnd() < p

function uuid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {
    // fall through
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (rnd() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function reference(at) {
  const d = new Date(at).toISOString().slice(0, 10).replace(/-/g, '')
  return `TXN${d}${Array.from({ length: 8 }, () => pick([...ALPHA])).join('')}`
}

const humanType = { TRANSFER: 'Transfer', DEPOSIT: 'Deposit', WITHDRAWAL: 'Withdrawal' }
const STATUS_LABEL = { PENDING: 'Pending', PROCESSING: 'Processing', UNDER_REVIEW: 'Under Review', COMPLETED: 'Completed', FAILED: 'Failed' }

const DESCRIPTIONS = {
  TRANSFER: ['Rent share', 'Dinner split', 'Family support', 'Invoice #4471', 'Trip expenses', 'Gift', 'Tuition fee', 'Consulting fee', 'Car EMI', 'Loan repayment'],
  DEPOSIT: ['Cash deposit · branch', 'Cheque deposit', 'Salary top-up', 'Refund received'],
  WITHDRAWAL: ['ATM withdrawal', 'Branch cash withdrawal', 'Card settlement', 'Bill payment'],
}
const NEW_CUSTOMERS = ['Aditi Kulkarni', 'Farhan Qureshi', 'Ishaan Bose', 'Meera Pillai', 'Nikhil Joshi', 'Pooja Reddy', 'Siddharth Menon', 'Tanvi Chawla', 'Yash Malhotra', 'Zoya Khan']
const FOREIGN = ['AE', 'US', 'SG', 'GB', 'RU', 'HK', 'DE']
const FREEZE_REASONS = ['Suspected account takeover', 'KYC documents expired', 'Customer request (lost card)', 'Chargeback investigation']

const activeAccounts = () => db.adminAccounts.filter((a) => a.status === 'Active')
const accountById = (id) => db.adminAccounts.find((a) => a.id === id)

// ---------------------------------------------------------------- Kafka log
// offsets[topic][partition] = next offset
const offsets = Object.fromEntries(TOPICS.map((t, i) => [t.id, [0, 1, 2].map((p) => [48210, 1284033, 1190412, 402118][i] + p * 977)]))

const eventLog = [] // newest first, full events
const auditRows = [] // newest first, audit-service shaped rows
const platformTxns = new Map() // id -> txn record (UI shape + correlationId + history)
const correlationByTxn = new Map()
let auditSeq = 90000

/** Gives a draft its Kafka coordinates and timestamp, then records it everywhere. */
function stamp(draft, at) {
  const topic = topicOf(draft.type)
  const key = draft.key || draft.aggregateId
  const partition = partitionFor(key)
  const offset = offsets[topic][partition]++
  const event = {
    eventId: uuid(),
    eventType: draft.type,
    aggregateId: draft.aggregateId,
    occurredAt: new Date(at).toISOString(),
    correlationId: draft.correlationId,
    source: draft.source || EVENT_TYPES[draft.type].source,
    schemaVersion: 1,
    payload: draft.payload,
    topic,
    partition,
    offset,
    key,
    severity: severityOf(draft.type, draft.payload),
  }
  draft.onEmit?.(event)
  eventLog.unshift(event)
  if (eventLog.length > 1500) eventLog.length = 1500
  auditRows.unshift(auditFromEvent(event))
  if (auditRows.length > 1500) auditRows.length = 1500
  return event
}

function auditFromEvent(e) {
  return {
    id: `au_${auditSeq++}`,
    eventId: e.eventId,
    timestamp: e.occurredAt,
    service: e.source,
    actor: actorOf(e.payload),
    action: e.eventType,
    entity: e.aggregateId,
    entityType: EVENT_TYPES[e.eventType]?.aggregateType || 'UNKNOWN',
    detail: summarizeEvent(e.eventType, e.payload),
    details: maskDetails(e.payload),
    severity: e.severity,
    correlationId: e.correlationId,
  }
}

// ---------------------------------------------------------------- saga builders
// A saga = list of drafts { gap (ms after previous), type, aggregateId, correlationId, payload, source?, key?, onEmit? }

function fraudVerdict(outcome, amount, country) {
  if (outcome === 'MEDIUM') return { score: 40, level: 'MEDIUM', rules: ['AmountThresholdRule'], ruleScores: { AmountThresholdRule: 40 }, reason: 'Amount above ₹1,00,000' }
  if (outcome === 'REVIEW') return { score: 65, level: 'HIGH', rules: ['AmountThresholdRule', 'GeographicRule'], ruleScores: { AmountThresholdRule: 40, GeographicRule: 25 }, reason: `Amount above ₹1,00,000 from outside India (${country})` }
  if (outcome === 'BLOCK') return { score: 95, level: 'CRITICAL', rules: ['AmountThresholdRule', 'GeographicRule'], ruleScores: { AmountThresholdRule: 70, GeographicRule: 25 }, reason: `Amount above ₹5,00,000 from outside India (${country})` }
  const night = chance(0.08)
  return night
    ? { score: 10, level: 'LOW', rules: ['PatternAnomalyRule'], ruleScores: { PatternAnomalyRule: 10 }, reason: 'Night-time transaction (00:00–05:00 IST)' }
    : { score: 0, level: 'LOW', rules: [], ruleScores: {}, reason: 'No rules triggered' }
}

function txnSaga(at, outcome, { live = false } = {}) {
  const accounts = activeAccounts()
  const kind = ['REVIEW', 'BLOCK', 'MEDIUM'].includes(outcome) ? 'TRANSFER' : pick(['TRANSFER', 'TRANSFER', 'TRANSFER', 'DEPOSIT', 'WITHDRAWAL'])
  const a = pick(accounts)
  let b = pick(accounts)
  while (b.id === a.id) b = pick(accounts)
  const src = kind === 'DEPOSIT' ? null : a
  const dst = kind === 'WITHDRAWAL' ? null : kind === 'DEPOSIT' ? a : b
  const holder = src || dst

  let amount
  if (outcome === 'MEDIUM') amount = between(100001, 190000)
  else if (outcome === 'REVIEW') amount = between(150000, 460000)
  else if (outcome === 'BLOCK') amount = between(520000, 900000)
  else if (outcome === 'INSUFFICIENT') amount = between(260000, 480000)
  else amount = Math.round(Math.exp(between(Math.log(250), Math.log(85000))))
  const country = ['REVIEW', 'BLOCK'].includes(outcome) ? pick(FOREIGN) : 'IN'

  const txnId = uuid()
  const corr = uuid()
  correlationByTxn.set(txnId, corr)
  const ref = reference(at)
  const description = pick(DESCRIPTIONS[kind])
  const base = {
    transactionId: txnId, reference: ref, transactionType: kind,
    sourceAccountId: src?.id || null, destinationAccountId: dst?.id || null,
    amount, currency: 'INR', initiatedBy: holder.customerId,
  }
  const verdict = fraudVerdict(outcome, amount, country)
  const record = {
    id: txnId, reference: ref, date: new Date(at).toISOString(), completedAt: null, description,
    category: humanType[kind], amount: kind === 'DEPOSIT' ? amount : -amount,
    type: kind === 'DEPOSIT' ? 'credit' : kind === 'WITHDRAWAL' ? 'debit' : 'internal',
    status: 'Pending', rawStatus: 'PENDING', currency: 'INR',
    accountIds: [src?.id, dst?.id].filter(Boolean), sourceAccountId: src?.id || null, destinationAccountId: dst?.id || null,
    transactionType: kind, failureReason: null, failureCode: null, riskScore: null,
    initiatedBy: holder.customerId, customer: holder.customer, counterparty: kind === 'TRANSFER' ? dst.customer : null,
    clientCountry: country, correlationId: corr, history: [],
  }
  const setStatus = (status, reason) => (e) => {
    record.history.push({ fromStatus: record.rawStatus === status ? null : record.rawStatus, toStatus: status, reason, changedAt: e.occurredAt })
    record.rawStatus = status
    record.status = STATUS_LABEL[status]
    if (status === 'COMPLETED') record.completedAt = e.occurredAt
  }

  const d = (type, payload, extra = {}) => ({ type, aggregateId: txnId, correlationId: corr, payload, gap: Math.round(between(260, 900)), ...extra })
  const drafts = [
    d('TRANSACTION_INITIATED', { ...base, description, clientCountry: country }, {
      gap: 0,
      onEmit: (e) => {
        platformTxns.set(txnId, record)
        record.date = e.occurredAt
        record.history.push({ fromStatus: null, toStatus: 'PENDING', reason: 'Transaction accepted (202)', changedAt: e.occurredAt })
      },
    }),
  ]
  const fraudPayload = {
    transactionId: txnId, riskScore: verdict.score, riskLevel: verdict.level, triggeredRules: verdict.rules,
    reason: verdict.reason, alertId: null, reviewedBy: null,
  }
  const setRisk = (e) => { record.riskScore = verdict.score; return e }

  if (outcome === 'REVIEW' || outcome === 'BLOCK') {
    const alertId = `fr_${Math.floor(between(6000, 9999))}`
    drafts.push(d('FRAUD_DETECTED', { ...fraudPayload, decision: outcome === 'BLOCK' ? 'BLOCK' : 'REVIEW', alertId }, {
      onEmit: (e) => {
        setRisk(e)
        if (outcome === 'REVIEW') setStatus('UNDER_REVIEW', `Flagged by fraud checks (${verdict.level} risk)`)(e)
        if (live) addLiveAlert({ alertId, record, verdict, status: outcome === 'BLOCK' ? 'Rejected' : 'Open', at: e.occurredAt, holder: src })
      },
    }))
    if (outcome === 'BLOCK') {
      drafts.push(d('TRANSACTION_FAILED', { ...base, failureReason: 'Blocked by fraud checks (CRITICAL risk)', failureCode: 'FRAUD_BLOCKED' }, {
        onEmit: (e) => { record.failureCode = 'FRAUD_BLOCKED'; record.failureReason = 'Blocked by fraud checks (CRITICAL risk)'; setStatus('FAILED', 'Fraud BLOCK')(e) },
      }))
    }
    drafts.push(d('NOTIFICATION_REQUESTED', {
      recipientId: holder.customerId, recipientEmail: `${holder.customer.split(' ')[0].toLowerCase()}@example.com`, recipientPhone: '+919800012345',
      channel: 'SMS', notificationType: 'GENERAL',
      subject: outcome === 'BLOCK' ? 'Payment blocked for your safety' : 'We are reviewing a payment',
      message: `Your ${humanType[kind].toLowerCase()} of ₹${amount.toLocaleString('en-IN')} ${outcome === 'BLOCK' ? 'was blocked' : 'is under review'}.`,
    }, { key: holder.customerId, aggregateId: holder.customerId, source: 'fraud-service' }))
    return drafts
  }

  drafts.push(d('FRAUD_CLEARED', { ...fraudPayload, decision: 'APPROVE' }, {
    onEmit: (e) => { setRisk(e); setStatus('PROCESSING', `Fraud check passed (risk ${verdict.score})`)(e) },
  }))
  drafts.push(d('BALANCE_UPDATE_REQUESTED', { ...base }))
  if (outcome === 'INSUFFICIENT') {
    drafts.push(d('BALANCE_UPDATE_FAILED', { transactionId: txnId, reason: 'Insufficient funds in source account', errorCode: 'INSUFFICIENT_FUNDS' }))
    drafts.push(d('TRANSACTION_FAILED', { ...base, failureReason: 'Insufficient funds in source account', failureCode: 'INSUFFICIENT_FUNDS' }, {
      onEmit: (e) => { record.failureCode = 'INSUFFICIENT_FUNDS'; record.failureReason = 'Insufficient funds in source account'; setStatus('FAILED', 'BALANCE_UPDATE_FAILED')(e) },
    }))
    return drafts
  }
  drafts.push(d('BALANCE_UPDATED', {
    transactionId: txnId, transactionType: kind, sourceAccountId: base.sourceAccountId, destinationAccountId: base.destinationAccountId,
    amount, currency: 'INR',
    sourceBalanceAfter: src ? Math.max(0, Math.round((src.balance - amount) * 100) / 100) : null,
    destinationBalanceAfter: dst ? Math.round((dst.balance + amount) * 100) / 100 : null,
  }))
  drafts.push(d('TRANSACTION_COMPLETED', { ...base, description, completedAt: null }, {
    onEmit: (e) => { e.payload.completedAt = e.occurredAt; setStatus('COMPLETED', 'Balances updated')(e) },
  }))
  if (amount > 50000 && chance(0.5)) {
    drafts.push(d('NOTIFICATION_REQUESTED', {
      recipientId: holder.customerId, recipientEmail: `${holder.customer.split(' ')[0].toLowerCase()}@example.com`, recipientPhone: '+919800012345',
      channel: 'EMAIL', notificationType: 'GENERAL', subject: 'High-value transaction processed',
      message: `₹${amount.toLocaleString('en-IN')} ${humanType[kind].toLowerCase()} completed.`,
    }, { key: holder.customerId, aggregateId: holder.customerId, source: 'transaction-service' }))
  }
  return drafts
}

function accountCreatedSaga() {
  const name = pick(NEW_CUSTOMERS)
  const accountId = uuid()
  const digits = String(Math.floor(1000000000 + rnd() * 8999999999))
  const type = pick(['SAVINGS', 'SAVINGS', 'CURRENT', 'FIXED_DEPOSIT'])
  const customerId = `CUST-${2000 + Math.floor(rnd() * 900)}`
  return [{
    gap: 0, type: 'ACCOUNT_CREATED', aggregateId: accountId, correlationId: uuid(),
    payload: {
      accountId, accountNumber: `ACC${digits}`, customerId, customerName: name,
      customerEmail: `${name.split(' ')[0].toLowerCase()}@example.com`, customerPhone: `+9198${digits.slice(0, 8)}`,
      accountType: type, currency: 'INR', initialBalance: type === 'FIXED_DEPOSIT' ? 100000 * Math.ceil(rnd() * 5) : Math.round(between(0, 50000)),
    },
  }]
}

function statusChangedSaga() {
  const acc = pick(db.adminAccounts.filter((a) => a.status !== 'Closed'))
  const freezing = acc.status === 'Active'
  return [{
    gap: 0, type: 'ACCOUNT_STATUS_CHANGED', aggregateId: acc.id, correlationId: uuid(),
    payload: {
      accountId: acc.id, accountNumber: acc.accountNumber, customerId: acc.customerId, customerEmail: `${acc.customer.split(' ')[0].toLowerCase()}@example.com`,
      customerName: acc.customer, previousStatus: freezing ? 'ACTIVE' : 'FROZEN', newStatus: freezing ? 'FROZEN' : 'ACTIVE',
      reason: freezing ? pick(FREEZE_REASONS) : 'Verification completed', changedBy: 'ADMIN-1',
    },
  }]
}

function randomSaga(at, opts = {}) {
  const r = rnd()
  // History has no open reviews (those live in the fraud queue): REVIEW becomes MEDIUM
  if (opts.backlog && r >= 0.77 && r < 0.81) return txnSaga(at, 'MEDIUM', opts)
  if (r < 0.66) return txnSaga(at, 'COMPLETED', opts)
  if (r < 0.73) return txnSaga(at, 'MEDIUM', opts)
  if (r < 0.77) return txnSaga(at, 'INSUFFICIENT', opts)
  if (r < 0.81) return txnSaga(at, 'REVIEW', opts)
  if (r < 0.83) return txnSaga(at, 'BLOCK', opts)
  if (r < 0.95) return accountCreatedSaga()
  return statusChangedSaga()
}

// ---------------------------------------------------------------- live fraud alerts
let liveAlerts = 0
function addLiveAlert({ alertId, record, verdict, status, at, holder }) {
  if (liveAlerts >= 5) return
  liveAlerts++
  db.fraudAlerts.unshift({
    id: alertId, txnId: record.id, customer: record.customer, accountNumber: holder?.number || '—', accountId: holder?.id,
    amount: Math.abs(record.amount), currency: 'INR', riskScore: verdict.score, riskLevel: verdict.level,
    triggeredRules: verdict.rules, ruleScores: verdict.ruleScores, clientCountry: record.clientCountry, transactionType: record.transactionType,
    reason: verdict.reason, status, reviewedBy: status === 'Rejected' ? 'SYSTEM' : undefined,
    reviewNotes: status === 'Rejected' ? 'Automatically blocked (CRITICAL risk)' : undefined, createdAt: at,
  })
}

// ---------------------------------------------------------------- backlog (history)
function buildBacklog() {
  const now = Date.now()
  const timed = []
  const push = (start, drafts) => {
    let t = start
    drafts.forEach((dr) => { t += dr.gap; timed.push({ at: t, draft: dr }) })
  }
  // ~36h of history, denser in the last 10 minutes so the stream opens busy
  for (let t = now - 36 * 3600e3; t < now - 10 * 60e3; t += between(6, 16) * 60e3) push(t, randomSaga(t, { backlog: true }))
  for (let t = now - 10 * 60e3; t < now - 8e3; t += between(14, 40) * 1e3) push(t, randomSaga(t, { backlog: true }))
  timed.sort((x, y) => x.at - y.at).filter((x) => x.at < now).forEach((x) => stamp(x.draft, x.at))

  // Seed fraud alerts and seed audit rows join the same story
  seed.fraudAlerts.forEach((a) => {
    const status = a.status === 'Open' ? 'UNDER_REVIEW' : a.status === 'Approved' ? 'COMPLETED' : 'FAILED'
    const acc = db.adminAccounts.find((x) => x.number === a.accountNumber)
    correlationByTxn.set(a.txnId, correlationByTxn.get(a.txnId) || uuid())
    platformTxns.set(a.txnId, {
      id: a.txnId, reference: reference(a.createdAt), date: a.createdAt, completedAt: status === 'COMPLETED' ? a.createdAt : null,
      description: a.transactionType === 'WITHDRAWAL' ? 'Branch cash withdrawal' : 'Outward transfer', category: humanType[a.transactionType],
      amount: -a.amount, type: a.transactionType === 'WITHDRAWAL' ? 'debit' : 'internal', status: STATUS_LABEL[status], rawStatus: status,
      currency: 'INR', accountIds: acc ? [acc.id] : [], sourceAccountId: acc?.id || null, destinationAccountId: null,
      transactionType: a.transactionType, failureReason: status === 'FAILED' ? 'Blocked by fraud checks (CRITICAL risk)' : null,
      failureCode: status === 'FAILED' ? 'FRAUD_BLOCKED' : null, riskScore: a.riskScore, initiatedBy: acc?.customerId || 'CUST-1000',
      customer: a.customer, counterparty: null, clientCountry: a.clientCountry, correlationId: correlationByTxn.get(a.txnId),
      history: [
        { fromStatus: null, toStatus: 'PENDING', reason: 'Transaction accepted (202)', changedAt: a.createdAt },
        { fromStatus: 'PENDING', toStatus: status === 'FAILED' ? 'FAILED' : 'UNDER_REVIEW', reason: `Fraud ${status === 'FAILED' ? 'BLOCK' : 'REVIEW'} · risk ${a.riskScore}`, changedAt: a.createdAt },
      ],
    })
  })
  const entityCorr = new Map()
  db.auditLog.forEach((l) => {
    if (!entityCorr.has(l.entity)) entityCorr.set(l.entity, correlationByTxn.get(l.entity) || uuid())
    auditRows.push({ eventId: uuid(), entityType: EVENT_TYPES[l.action]?.aggregateType || 'UNKNOWN', details: { detail: l.detail }, ...clone(l), correlationId: entityCorr.get(l.entity) })
  })
  auditRows.sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp))
}
buildBacklog()

// ---------------------------------------------------------------- live stream
const listeners = new Set()
let queue = [] // { due, draft }
let timer = null
let nextSagaAt = 0

function schedule(drafts, start = Date.now()) {
  let t = start
  drafts.forEach((dr) => { t += dr.gap; queue.push({ due: t, draft: dr }) })
}

function tick() {
  const now = Date.now()
  if (now >= nextSagaAt) {
    schedule(randomSaga(now, { live: true }), now)
    nextSagaAt = now + between(1000, 1900)
  }
  flush()
}

/** Emits every queued draft that is due. */
function flush() {
  const now = Date.now()
  const due = queue.filter((q) => q.due <= now).sort((a, b) => a.due - b.due)
  if (!due.length) return
  queue = queue.filter((q) => q.due > now)
  const events = due.map((q) => stamp(q.draft, Math.min(q.due, now)))
  listeners.forEach((fn) => fn(events))
}

/** Subscribe to live events. `backfill` = number of recent events delivered first. Returns unsubscribe. */
export function subscribeEvents(fn, { backfill = 0 } = {}) {
  listeners.add(fn)
  if (backfill > 0) {
    const initial = clone(eventLog.slice(0, backfill))
    setTimeout(() => listeners.has(fn) && fn(initial), 350)
  }
  if (!timer) {
    nextSagaAt = Date.now() + 600
    timer = setInterval(tick, 200)
  }
  return () => {
    listeners.delete(fn)
    if (!listeners.size && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function recentEvents(limit = 60) {
  return delay(clone(eventLog.slice(0, limit)), 200)
}

export function eventsByCorrelation(correlationId) {
  const events = eventLog.filter((e) => e.correlationId === correlationId)
  if (events.length) return delay(clone(events).reverse(), 150)
  // Seed audit rows have no full event; rebuild a thin one from the audit row
  return delay(null, 150).then(() => null)
}

// Called by fraudService after an admin decision: plays the rest of the saga.
export function onAlertReviewed(alert, decision) {
  const txnId = alert.txnId
  const corr = correlationByTxn.get(txnId) || uuid()
  correlationByTxn.set(txnId, corr)
  const record = platformTxns.get(txnId)
  const base = {
    transactionId: txnId, reference: record?.reference || txnId.toUpperCase(), transactionType: alert.transactionType || 'TRANSFER',
    sourceAccountId: record?.sourceAccountId || alert.accountId || null, destinationAccountId: record?.destinationAccountId || null,
    amount: alert.amount, currency: alert.currency || 'INR', initiatedBy: record?.initiatedBy || 'CUST-1000',
  }
  const fraud = {
    transactionId: txnId, riskScore: alert.riskScore, riskLevel: alert.riskLevel, triggeredRules: alert.triggeredRules || [],
    reason: alert.reason, alertId: alert.id, reviewedBy: 'ADMIN-1',
  }
  const mark = (status, reason) => (e) => {
    if (!record) return
    record.history.push({ fromStatus: record.rawStatus, toStatus: status, reason, changedAt: e.occurredAt })
    record.rawStatus = status
    record.status = STATUS_LABEL[status]
    if (status === 'COMPLETED') record.completedAt = e.occurredAt
    if (status === 'FAILED') { record.failureCode = 'FRAUD_BLOCKED'; record.failureReason = 'Rejected by analyst' }
  }
  const d = (type, payload, gap, extra = {}) => ({ type, aggregateId: txnId, correlationId: corr, payload, gap, ...extra })
  const drafts = decision === 'APPROVE'
    ? [
        d('FRAUD_CLEARED', { ...fraud, decision: 'APPROVE' }, 150, { onEmit: mark('PROCESSING', 'Approved by ADMIN-1') }),
        d('BALANCE_UPDATE_REQUESTED', base, 500),
        d('BALANCE_UPDATED', { transactionId: txnId, transactionType: base.transactionType, sourceAccountId: base.sourceAccountId, destinationAccountId: null, amount: alert.amount, currency: base.currency, sourceBalanceAfter: null, destinationBalanceAfter: null }, 700),
        d('TRANSACTION_COMPLETED', { ...base, completedAt: null }, 450, { onEmit: (e) => { e.payload.completedAt = e.occurredAt; mark('COMPLETED', 'Balances updated')(e) } }),
      ]
    : [
        d('FRAUD_DETECTED', { ...fraud, decision: 'BLOCK' }, 150),
        d('TRANSACTION_FAILED', { ...base, failureReason: 'Rejected by analyst', failureCode: 'FRAUD_BLOCKED' }, 600, { onEmit: mark('FAILED', 'Rejected by ADMIN-1') }),
      ]
  schedule(drafts)
  drainSoon()
}

export function onAccountStatusChanged(account, newStatus, reason) {
  const drafts = [{
    gap: 120, type: 'ACCOUNT_STATUS_CHANGED', aggregateId: account.id, correlationId: uuid(),
    payload: {
      accountId: account.id, accountNumber: account.accountNumber || account.number, customerId: account.customerId, customerName: account.customer,
      customerEmail: `${String(account.customer || 'customer').split(' ')[0].toLowerCase()}@example.com`,
      previousStatus: newStatus === 'Frozen' ? 'ACTIVE' : 'FROZEN', newStatus: newStatus === 'Frozen' ? 'FROZEN' : 'ACTIVE',
      reason: reason || (newStatus === 'Frozen' ? 'Frozen by admin' : 'Unfrozen by admin'), changedBy: 'ADMIN-1',
    },
  }]
  schedule(drafts)
  drainSoon()
}

// Plays queued drafts even when no page is subscribed (e.g. review done, then navigate away).
function drainSoon() {
  if (timer) return
  const t = setInterval(() => {
    if (timer) { clearInterval(t); return }
    flush()
    if (!queue.length) clearInterval(t)
  }, 200)
}

// ---------------------------------------------------------------- transactions
export function listPlatformTransactions() {
  const items = [...platformTxns.values()].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 400)
  return delay(clone(items), 300)
}

export function transactionHistory(id) {
  const t = platformTxns.get(id)
  return delay(t ? clone(t.history) : [], 150)
}

export function accountTransactions(accountId) {
  const own = db.transactions.filter((t) => t.accountId === accountId).map((t) => ({ currency: 'INR', reference: t.id, ...t }))
  const platform = [...platformTxns.values()].filter((t) => t.sourceAccountId === accountId || t.destinationAccountId === accountId)
  const all = [...platform, ...own].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6)
  return delay(clone(all), 250)
}

// ---------------------------------------------------------------- audit
export function listAuditLogs({ eventType, severity, actor, from, to } = {}) {
  const f = from ? new Date(from).getTime() : null
  const t = to ? new Date(to).getTime() : null
  const rows = auditRows.filter((r) => {
    if (eventType && r.action !== eventType) return false
    if (severity && r.severity !== severity) return false
    if (actor && !String(r.actor).toLowerCase().includes(String(actor).toLowerCase())) return false
    const ts = new Date(r.timestamp).getTime()
    if (f && ts < f) return false
    if (t && ts > t) return false
    return true
  })
  return delay(clone(rows.slice(0, 600)), 280)
}

export function auditByCorrelation(correlationId) {
  return delay(clone(auditRows.filter((r) => r.correlationId === correlationId)).reverse(), 200)
}

export function auditByAggregate(aggregateId) {
  return delay(clone(auditRows.filter((r) => r.entity === aggregateId)).reverse(), 200)
}

// ---------------------------------------------------------------- health
const latencyHistory = new Map()
function jitterHistory(s) {
  let h = latencyHistory.get(s.name)
  if (!h) {
    h = Array.from({ length: 20 }, (_, i) => Math.max(4, Math.round(s.latencyMs * (0.92 + 0.08 * Math.sin(i * 0.6 + s.port) + 0.04 * Math.cos(i * 1.9)))))
    latencyHistory.set(s.name, h)
  }
  const prev = h[h.length - 1]
  const next = Math.max(4, Math.round(prev * 0.6 + s.latencyMs * between(0.88, 1.14) * 0.4))
  h.push(next)
  if (h.length > 30) h.shift()
  return { latest: next, history: [...h] }
}

export function getSystemHealth() {
  const services = db.services.map((s) => {
    const { latest, history } = jitterHistory(s)
    return { ...clone(s), latencyMs: latest, history, url: `http://localhost:${s.port}/actuator/health` }
  })
  const allUp = services.every((s) => s.status === 'Operational')
  return delay({ status: allUp ? 'UP' : 'DEGRADED', services, checkedAt: new Date().toISOString() }, 350)
}

// ---------------------------------------------------------------- fraud stats
export function fraudStats() {
  const alerts = db.fraudAlerts
  const by = (s) => alerts.filter((a) => a.status === s).length
  return delay({
    totalAlerts: alerts.length,
    alertsByStatus: { OPEN: by('Open'), APPROVED: by('Approved'), REJECTED: by('Rejected') },
    totalDecisions: 128940,
    decisionsByRiskLevel: { LOW: 119880, MEDIUM: 8694, HIGH: 296, CRITICAL: 70 },
  }, 200)
}

// ---------------------------------------------------------------- dashboard
const DAY = 86400000
function series(end, n, drift, noise, seedN) {
  // deterministic wobble ending exactly at `end`
  return Array.from({ length: n }, (_, i) => {
    const back = n - 1 - i
    const w = Math.sin((i + seedN) * 1.3) * noise + Math.cos((i + seedN) * 0.7) * noise * 0.5
    return back === 0 ? end : Math.round(end * (1 - drift * back) + end * w)
  })
}
const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0)

export function adminOverview() {
  const m = seed.adminMetrics
  const daily = seed.platformDailyVolume
  const counts = daily.map((d) => d.count)
  counts[counts.length - 1] = m.transactionsToday
  const avgTicket = m.transactionVolumeToday / m.transactionsToday
  const volumes = counts.map((c, i) => Math.round(c * avgTicket * (0.94 + 0.1 * Math.abs(Math.sin(i * 2.1)))))
  volumes[volumes.length - 1] = m.transactionVolumeToday
  const openNow = db.fraudAlerts.filter((a) => a.status === 'Open').length
  const fraudSpark = [2, 3, 2, 4, 3, 1, 2, 3, 5, 4, 2, 3, 2, openNow]
  const latencySpark = [228, 219, 231, 214, 209, 222, 236, 218, 205, 211, 219, 207, 214, 212]
  const customers = series(m.totalCustomers, 14, 0.0009, 0.0006, 1)
  const accounts = series(m.totalAccounts, 14, 0.0011, 0.0005, 3)

  const wk = (arr) => pct(arr[arr.length - 1], arr[arr.length - 8])
  const dd = (arr) => pct(arr[arr.length - 1], arr[arr.length - 2])
  const hourly = clone(seed.platformTxnVolume)
  const yesterday = hourly.map((v, i) => Math.round(v * (0.9 + 0.08 * Math.sin(i * 0.9))))

  return delay({
    kpis: {
      customers: { value: m.totalCustomers, spark: customers, delta: wk(customers), deltaLabel: 'vs last week' },
      accounts: { value: m.totalAccounts, spark: accounts, delta: wk(accounts), deltaLabel: 'vs last week' },
      transactions24h: { value: m.transactionsToday, spark: counts, delta: dd(counts), deltaLabel: 'vs yesterday' },
      volume24h: { value: m.transactionVolumeToday, spark: volumes, delta: dd(volumes), deltaLabel: 'vs yesterday' },
      openFraud: { value: openNow, spark: fraudSpark, delta: openNow - fraudSpark[fraudSpark.length - 2], deltaLabel: 'since yesterday', absolute: true },
      p95LatencyMs: { value: 212, spark: latencySpark, delta: pct(212, latencySpark[latencySpark.length - 2]), deltaLabel: 'vs yesterday' },
    },
    currency: 'INR',
    hourly: { today: hourly, yesterday },
    daily: daily.map((d, i) => ({ date: d.date, completed: (i === daily.length - 1 ? m.transactionsToday : d.count) - d.failed, failed: d.failed })),
    risk: { decisions: { LOW: 119880, MEDIUM: 8694, HIGH: 296, CRITICAL: 70 }, alerts: countAlertsByLevel(db.fraudAlerts) },
    services: db.services.map((s) => ({ ...clone(s), latencyMs: Math.max(4, Math.round(s.latencyMs * between(0.9, 1.1))) })),
    topics: seed.eventPipeline.map((t, i) => ({
      ...t,
      throughput: Math.round(t.throughput * between(0.9, 1.1)),
      lag: Math.max(0, Math.round(t.lag * between(0.6, 1.4))),
      dlt: [0, 2, 0, 1][i],
      producer: TOPICS[i].producer,
      spark: Array.from({ length: 16 }, (_, k) => Math.round(t.throughput * (0.8 + 0.35 * Math.abs(Math.sin(k * 0.8 + i))))),
    })),
    openAlerts: clone(db.fraudAlerts.filter((a) => a.status === 'Open')),
    sampleNote: 'Demo data · platform-scale metrics',
    errors: [],
  }, 400)
}

function countAlertsByLevel(alerts) {
  const out = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }
  alerts.forEach((a) => { if (out[a.riskLevel] !== undefined) out[a.riskLevel] += 1 })
  return out
}

export { DAY }
