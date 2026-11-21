// Builds the two overview pages from several services (there is no single "dashboard" API).
import { USE_MOCK, DEFAULT_CURRENCY } from '../lib/config.js'
import { listMyAccounts, listAllAccounts } from './accountService.js'
import { listMyTransactions, listAllTransactions } from './transactionService.js'
import { listAlerts } from './fraudService.js'
import { getSystemHealth } from './systemService.js'
import * as mock from './mock/mockStore.js'

const DAY = 24 * 60 * 60 * 1000

/** Spending (money out) grouped by category over the last `days` days. */
function spendingByCategory(transactions, days = 30) {
  const since = Date.now() - days * DAY
  const totals = {}
  transactions
    .filter((t) => t.type === 'debit' && t.rawStatus !== 'FAILED' && new Date(t.date).getTime() >= since)
    .forEach((t) => { totals[t.category] = (totals[t.category] || 0) + Math.abs(t.amount) })
  return Object.entries(totals)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
}

/**
 * Approximate 12-week balance history: start from today's total and walk backwards,
 * undoing each week's completed money in/out.
 */
function balanceTrend(total, transactions, weeks = 12) {
  const now = Date.now()
  const points = []
  for (let w = 0; w < weeks; w++) {
    const boundary = now - w * 7 * DAY
    const netAfter = transactions
      .filter((t) => t.rawStatus === 'COMPLETED' && t.type !== 'internal' && new Date(t.date).getTime() > boundary)
      .reduce((s, t) => s + t.amount, 0)
    points.unshift(total - netAfter)
  }
  return points
}

/** Customer overview: accounts, recent activity, spending, balance trend. */
export async function getCustomerOverview(user) {
  const accounts = await listMyAccounts(user)
  const transactions = await listMyTransactions(accounts)
  const currency = accounts[0]?.currency || DEFAULT_CURRENCY
  const total = accounts.filter((a) => a.currency === currency).reduce((s, a) => s + a.balance, 0)
  const since = Date.now() - 30 * DAY
  // (mock dates are fixed in the past, so mock mode uses the whole sample)
  const recent30 = transactions.filter((t) => (USE_MOCK || new Date(t.date).getTime() >= since) && t.rawStatus !== 'FAILED')

  return {
    accounts,
    transactions,
    currency,
    total,
    moneyIn: recent30.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0),
    moneyOut: recent30.filter((t) => t.type === 'debit').reduce((s, t) => s + Math.abs(t.amount), 0),
    spending: USE_MOCK ? mock.spendingByCategory() : spendingByCategory(transactions),
    trend: USE_MOCK ? mock.balanceTrend() : balanceTrend(total, transactions),
  }
}

/**
 * Admin overview. Each source is loaded independently so one service being down
 * still leaves the rest of the dashboard usable (`errors` lists what failed).
 */
export async function getAdminOverview() {
  if (USE_MOCK) return mock.adminOverview()

  const [accountsRes, txnRes, alertsRes, healthRes] = await Promise.allSettled([
    listAllAccounts(),
    listAllTransactions(),
    listAlerts({ status: 'OPEN' }),
    getSystemHealth(),
  ])
  const errors = []
  const value = (res, label) => {
    if (res.status === 'fulfilled') return res.value
    errors.push({ label, message: res.reason?.message || 'Failed to load' })
    return null
  }

  const accounts = value(accountsRes, 'Accounts')
  const txns = value(txnRes, 'Transactions')
  const alerts = value(alertsRes, 'Fraud alerts')
  const health = value(healthRes, 'Service health')

  const accountLookup = new Map((accounts?.items || []).map((a) => [a.id, a]))
  const since = Date.now() - DAY
  const last24h = (txns?.items || []).filter((t) => new Date(t.date).getTime() >= since)

  // Transactions per hour, oldest hour first.
  const hourly = Array.from({ length: 24 }, () => 0)
  last24h.forEach((t) => {
    const hoursAgo = Math.floor((Date.now() - new Date(t.date).getTime()) / 3600000)
    if (hoursAgo >= 0 && hoursAgo < 24) hourly[23 - hoursAgo] += 1
  })

  const statusCounts = {}
  ;(txns?.items || []).forEach((t) => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1 })

  const openAlerts = (alerts || []).map((a) => {
    const acc = accountLookup.get(a.accountId)
    return acc ? { ...a, customer: acc.customer, accountNumber: acc.number } : a
  })

  return {
    metrics: {
      customers: accounts ? new Set(accounts.items.map((a) => a.customerId || a.customer)).size : null,
      accounts: accounts ? accounts.total : null,
      transactions24h: txns ? last24h.length : null,
      volume24h: txns ? last24h.filter((t) => t.rawStatus === 'COMPLETED').reduce((s, t) => s + Math.abs(t.amount), 0) : null,
      openFraud: alerts ? alerts.length : null,
      underReview: txns ? statusCounts['Under Review'] || 0 : null,
    },
    currency: txns?.items?.[0]?.currency || DEFAULT_CURRENCY,
    hourlyVolume: hourly,
    services: health?.services || [],
    openAlerts,
    statusBreakdown: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
    sampleNote: 'Based on the latest 100 records per service',
    errors,
  }
}
