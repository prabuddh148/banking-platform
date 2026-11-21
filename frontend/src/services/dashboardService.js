// Builds the two overview pages from several services (there is no single "dashboard" API).
import { USE_MOCK, DEFAULT_CURRENCY } from '../lib/config.js'
import { listMyAccounts, listAllAccounts } from './accountService.js'
import { listMyTransactions, listAllTransactions } from './transactionService.js'
import { listAlerts } from './fraudService.js'
import { getSystemHealth } from './systemService.js'
import { isFailedTxn, isSettledTxn } from './mappers.js'
import { formatCurrency } from '../lib/format.js'
import * as mock from './mock/mockStore.js'

const DAY = 24 * 60 * 60 * 1000

const ts = (t) => new Date(t.date).getTime()
/** Money that really moved in/out of the customer (no failed rows, no own-account shuffles). */
const counts = (t) => !isFailedTxn(t) && t.type !== 'internal'
const sumIn = (list) => list.filter((t) => counts(t) && t.type === 'credit').reduce((s, t) => s + t.amount, 0)
const sumOut = (list) => list.filter((t) => counts(t) && t.type === 'debit').reduce((s, t) => s + Math.abs(t.amount), 0)

/** Spending (money out) grouped by category for transactions in [from, to). */
export function spendingByCategory(transactions, from = Date.now() - 30 * DAY, to = Infinity) {
  const totals = {}
  transactions
    .filter((t) => counts(t) && t.type === 'debit' && ts(t) >= from && ts(t) < to)
    .forEach((t) => { totals[t.category] = (totals[t.category] || 0) + Math.abs(t.amount) })
  return Object.entries(totals)
    .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
}

/** Total balance at a past instant: today's total minus everything that settled after it. */
function balanceAt(total, transactions, instant) {
  const netAfter = transactions
    .filter((t) => isSettledTxn(t) && t.type !== 'internal' && ts(t) > instant)
    .reduce((s, t) => s + t.amount, 0)
  return total - netAfter
}

/** Weekly balance history (oldest first) with "12 Sep" style labels. */
function balanceTrend(total, transactions, weeks = 12) {
  const now = Date.now()
  const points = []
  for (let w = weeks - 1; w >= 0; w--) {
    const at = now - w * 7 * DAY
    points.push({
      label: new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      value: Math.round(balanceAt(total, transactions, at)),
    })
  }
  return points
}

/** Income vs spending per calendar month that the history covers (up to 6, oldest first). */
function monthlyCashflow(transactions, maxMonths = 6) {
  const now = new Date()
  const oldest = transactions.length ? Math.min(...transactions.map(ts)) : Date.now()
  const months = []
  for (let m = maxMonths - 1; m >= 0; m--) {
    const start = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - m + 1, 1)
    // skip leading months the history doesn't fully cover (a half month would look like a dip)
    if (months.length === 0 && m >= 2 && oldest > start.getTime() + 5 * DAY) continue
    const inMonth = transactions.filter((t) => ts(t) >= start.getTime() && ts(t) < end.getTime())
    months.push({
      label: start.toLocaleDateString('en-IN', { month: 'short' }),
      income: Math.round(sumIn(inMonth)),
      spending: Math.round(sumOut(inMonth)),
      partial: m === 0,
    })
  }
  return months
}

/** Percentage change, or null when there is nothing to compare with. */
const pct = (now, before) => (before > 0 ? ((now - before) / before) * 100 : null)

const FIXED_COSTS = ['Rent', 'Investments']

/**
 * Short, data-driven observations for the "Insights" card: category changes vs the
 * same point last month, the biggest purchase and recurring subscriptions.
 */
function buildInsights(transactions, { monthStart, lastMonthStart, sameDayLastMonth, fmt }) {
  const insights = []
  const nowCats = spendingByCategory(transactions, monthStart)
  const prevMap = Object.fromEntries(spendingByCategory(transactions, lastMonthStart, sameDayLastMonth).map((c) => [c.category, c.amount]))
  nowCats
    .filter((c) => (prevMap[c.category] || 0) > 500 && !FIXED_COSTS.includes(c.category))
    .map((c) => ({ ...c, change: pct(c.amount, prevMap[c.category]) }))
    .filter((c) => Math.abs(c.change) >= 5)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 2)
    .forEach((c) => {
      const less = c.change < 0
      insights.push({
        kind: less ? 'good' : 'warn',
        category: c.category,
        title: `You spent ${Math.abs(Math.round(c.change))}% ${less ? 'less' : 'more'} on ${c.category.toLowerCase()}`,
        detail: `${fmt(c.amount)} so far this month vs ${fmt(prevMap[c.category])} by this point last month.`,
      })
    })

  const biggest = transactions
    .filter((t) => counts(t) && t.type === 'debit' && ts(t) >= monthStart && !FIXED_COSTS.includes(t.category))
    .sort((a, b) => a.amount - b.amount)[0]
  if (biggest) {
    insights.push({
      kind: 'info',
      category: biggest.category,
      title: `Biggest purchase: ${biggest.description}`,
      detail: `${fmt(Math.abs(biggest.amount))} on ${new Date(biggest.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.`,
    })
  }

  const subs = transactions.filter((t) => counts(t) && t.category === 'Subscriptions' && ts(t) >= lastMonthStart)
  if (subs.length) {
    const names = [...new Set(subs.map((t) => t.description))]
    const monthly = names.reduce((s, n) => s + Math.abs(subs.find((t) => t.description === n).amount), 0)
    insights.push({
      kind: 'info',
      category: 'Subscriptions',
      title: `${names.length} active subscription${names.length > 1 ? 's' : ''}`,
      detail: `${names.join(', ')}: about ${fmt(monthly)} a month.`,
    })
  }
  return insights
}

/**
 * Customer overview: accounts, recent activity and month-to-date analytics
 * (money in/out with deltas, savings rate, cashflow, spending, balance trend, insights).
 * Everything is derived from the account + transaction APIs (there is no analytics endpoint),
 * so it works the same in mock and real mode.
 */
export async function getCustomerOverview(user) {
  const accounts = await listMyAccounts(user)
  const transactions = await listMyTransactions(accounts)
  const currency = accounts[0]?.currency || DEFAULT_CURRENCY
  const total = accounts.filter((a) => a.currency === currency).reduce((s, a) => s + a.balance, 0)
  const fmt = (v) => formatCurrency(Math.round(v), currency).replace(/\.00$/, '')

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
  // the same day-of-month last month (clamped), so month-to-date numbers compare like for like
  const lastMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate()
  const sameDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), lastMonthDays), now.getHours(), now.getMinutes()).getTime()

  const mtd = transactions.filter((t) => ts(t) >= monthStart)
  const prevMtd = transactions.filter((t) => ts(t) >= lastMonthStart && ts(t) < sameDayLastMonth)
  const moneyIn = sumIn(mtd)
  const moneyOut = sumOut(mtd)
  const prevIn = sumIn(prevMtd)
  const prevOut = sumOut(prevMtd)
  const savingsRate = moneyIn > 0 ? ((moneyIn - moneyOut) / moneyIn) * 100 : null
  const prevSavingsRate = prevIn > 0 ? ((prevIn - prevOut) / prevIn) * 100 : null
  const balanceMonthAgo = balanceAt(total, transactions, Date.now() - 30 * DAY)

  // money in/out per day over the last 30 days (KPI sparklines)
  const daily = (dir) => Array.from({ length: 30 }, (_, i) => {
    const from = Date.now() - (30 - i) * DAY
    const day = transactions.filter((t) => ts(t) >= from && ts(t) < from + DAY)
    return dir === 'in' ? sumIn(day) : sumOut(day)
  })

  return {
    accounts,
    transactions,
    currency,
    total,
    balanceChange: { amount: total - balanceMonthAgo, pct: pct(total, balanceMonthAgo) },
    moneyIn,
    moneyOut,
    savingsRate,
    deltas: {
      moneyIn: pct(moneyIn, prevIn),
      moneyOut: pct(moneyOut, prevOut),
      savingsRate: savingsRate !== null && prevSavingsRate !== null ? savingsRate - prevSavingsRate : null,
    },
    dailyIn: daily('in'),
    dailyOut: daily('out'),
    spending: spendingByCategory(transactions, monthStart),
    cashflow: monthlyCashflow(transactions),
    trend: balanceTrend(total, transactions),
    insights: buildInsights(transactions, { monthStart, lastMonthStart, sameDayLastMonth, fmt }),
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
