// Admin console data that is composed from several services (there is no single admin API).
import { api, pageContent } from '../lib/api.js'
import { API_V1, USE_MOCK, DEFAULT_CURRENCY } from '../lib/config.js'
import { listAllAccounts } from './accountService.js'
import { listAllTransactions, mapTransaction, getTransactionStatus } from './transactionService.js'
import { listAlerts, getFraudStats } from './fraudService.js'
import { getSystemHealth } from './systemService.js'
import { TOPICS } from './eventCatalog.js'
import * as adminMock from './mock/adminMock.js'

const HOUR = 3600000
const DAY = 24 * HOUR
const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

function p95(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b)
  if (!v.length) return null
  return v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)]
}

/**
 * Admin overview. Each source loads independently so one service being down still
 * leaves the rest of the dashboard usable (`errors` lists what failed).
 * Shape: { kpis, currency, hourly: {today, yesterday?}, daily: [{date, completed, failed}],
 *          risk: {decisions, alerts}, services, topics, openAlerts, sampleNote, errors }
 */
export async function getAdminOverview() {
  if (USE_MOCK) return adminMock.adminOverview()

  const errors = []
  const settle = async (label, fn) => {
    try { return await fn() } catch (err) { errors.push({ label, message: err?.message || 'Failed to load' }); return null }
  }
  const [accounts, health, stats] = await Promise.all([
    settle('Accounts', () => listAllAccounts()),
    settle('Service health', () => getSystemHealth()),
    settle('Fraud stats', () => getFraudStats()),
  ])
  const accountItems = accounts?.items || []
  const [txns, alerts] = await Promise.all([
    settle('Transactions', () => listAllTransactions({ accounts: accountItems })),
    settle('Fraud alerts', () => listAlerts({ accounts: accountItems })),
  ])

  const now = Date.now()
  const items = txns?.items || []
  const last24 = items.filter((t) => now - new Date(t.date).getTime() < DAY)
  const hourly = Array.from({ length: 24 }, () => 0)
  const hourlyVolume = Array.from({ length: 24 }, () => 0)
  last24.forEach((t) => {
    const h = Math.floor((now - new Date(t.date).getTime()) / HOUR)
    if (h >= 0 && h < 24) {
      hourly[23 - h] += 1
      if (t.rawStatus === 'COMPLETED') hourlyVolume[23 - h] += Math.abs(t.amount)
    }
  })
  const daily = Array.from({ length: 14 }, (_, i) => {
    const start = new Date(now - (13 - i) * DAY)
    start.setHours(0, 0, 0, 0)
    const end = start.getTime() + DAY
    const inDay = items.filter((t) => { const ts = new Date(t.date).getTime(); return ts >= start.getTime() && ts < end })
    return { date: start.toISOString(), completed: inDay.filter((t) => t.rawStatus === 'COMPLETED').length, failed: inDay.filter((t) => t.rawStatus === 'FAILED').length }
  })

  const open = (alerts || []).filter((a) => a.status === 'Open')
  const alertsByLevel = Object.fromEntries(LEVELS.map((l) => [l, (alerts || []).filter((a) => a.riskLevel === l).length]))
  const services = health?.services || []

  return {
    kpis: {
      customers: { value: accounts ? new Set(accountItems.map((a) => a.customerId || a.customer)).size : null },
      accounts: { value: accounts ? accounts.total : null },
      transactions24h: { value: txns ? last24.length : null, spark: txns ? hourly : null },
      volume24h: { value: txns ? hourlyVolume.reduce((s, v) => s + v, 0) : null, spark: txns ? hourlyVolume : null },
      openFraud: { value: alerts ? open.length : null },
      p95LatencyMs: { value: p95(services.map((s) => s.latencyMs)), hint: 'Gateway health probes' },
    },
    currency: items[0]?.currency || DEFAULT_CURRENCY,
    hourly: { today: hourly },
    daily,
    risk: { decisions: stats?.decisionsByRiskLevel || null, alerts: alertsByLevel },
    services,
    topics: TOPICS.map((t) => ({ topic: t.id, partitions: t.partitions, producer: t.producer, lag: null, throughput: null, dlt: null })),
    openAlerts: open,
    sampleNote: 'Based on the latest 100 records per service',
    errors,
  }
}

/** Platform-wide transactions for the monitor (UI shape from transactionService.mapTransaction). */
export async function listPlatformTransactions() {
  if (USE_MOCK) {
    const items = await adminMock.listPlatformTransactions()
    return { items, total: items.length }
  }
  const accounts = await listAllAccounts().then((r) => r.items).catch(() => [])
  const res = await listAllTransactions({ accounts })
  const lookup = new Map(accounts.map((a) => [a.id, a]))
  return {
    ...res,
    items: res.items.map((t) => ({ ...t, counterparty: t.transactionType === 'TRANSFER' ? lookup.get(t.destinationAccountId)?.customer || null : null })),
  }
}

/** Status history of one transaction: [{ fromStatus, toStatus, reason, changedAt }]. */
export async function getTransactionHistory(id) {
  if (USE_MOCK) return adminMock.transactionHistory(id)
  const res = await getTransactionStatus(id)
  return res?.history || []
}

/** Latest transactions touching one account (admin filter `accountId`). */
export async function listAccountTransactions(accountId) {
  if (USE_MOCK) return adminMock.accountTransactions(accountId)
  const page = await api.get(`${API_V1}/transactions`, { query: { page: 0, size: 6, accountId } })
  return pageContent(page).map((t) => mapTransaction(t))
}

/** Mock only: publish ACCOUNT_STATUS_CHANGED to the simulated stream (the real backend does it itself). */
export function recordAccountStatusChange(account, newStatus, reason) {
  if (USE_MOCK) adminMock.onAccountStatusChanged(account, newStatus, reason)
}
