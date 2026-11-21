// In-memory "backend" used when VITE_USE_MOCK=true.
//
// Starts from the bundled mockData and keeps mutable copies, so actions in the UI
// (open an account, transfer, freeze, review a fraud alert, mark read) behave
// sensibly until the page is reloaded. Every function resolves after a short
// delay so loading states are visible, like with a real network.
import * as seed from '../../data/mockData.js'
import { ApiError } from '../../lib/api.js'

const clone = (v) => JSON.parse(JSON.stringify(v))

const db = {
  accounts: clone(seed.accounts),
  adminAccounts: clone(seed.adminAccounts),
  transactions: clone(seed.transactions),
  notifications: clone(seed.notifications),
  fraudAlerts: clone(seed.fraudAlerts),
  auditLog: clone(seed.auditLog),
  services: clone(seed.services),
  // transfers created in this session: id -> { createdAt, outcome, failureReason, applied, history }
  transfers: {},
}

export function delay(value, ms = 250) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

let counter = 1
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`

// ---------------------------------------------------------------- auth
export function login(username, password) {
  const match = seed.demoUsers.find((u) => u.username === username && u.password === password)
  if (!match) {
    return delay(null).then(() => {
      throw new ApiError('Invalid username or password', { code: 'INVALID_CREDENTIALS', status: 401 })
    })
  }
  return delay({ accessToken: `mock-token-${match.username}`, tokenType: 'Bearer', expiresIn: 3600, user: clone(match.user) })
}

// ---------------------------------------------------------------- accounts
export function listAccounts() {
  return delay(clone(db.accounts))
}

export function listAllAccounts() {
  return delay(clone(db.adminAccounts.map((a) => ({ currency: 'INR', ...a }))))
}

export function openAccount(form) {
  const type = { SAVINGS: 'Savings', CURRENT: 'Current', FIXED_DEPOSIT: 'Fixed Deposit' }[form.accountType] || 'Savings'
  const digits = String(Math.floor(1000000000 + Math.random() * 8999999999))
  const deposit = Number(form.initialDeposit) || 0
  const account = {
    id: nextId('acc'),
    name: `${type} Account`,
    type,
    accountNumber: `ACC${digits}`,
    number: `**** ${digits.slice(-4)}`,
    balance: deposit,
    available: deposit,
    currency: form.currency || 'INR',
    status: 'Active',
    customer: form.customerName,
    opened: new Date().toISOString(),
  }
  db.accounts.push(account)
  db.adminAccounts.unshift({ id: account.id, customer: form.customerName, type, number: account.number, balance: deposit, currency: account.currency, status: 'Active', opened: account.opened })
  return delay(clone(account), 400)
}

export function setAccountStatus(id, status) {
  const row = db.adminAccounts.find((a) => a.id === id)
  if (!row) return delay(null).then(() => { throw new ApiError('Account not found', { code: 'ACCOUNT_NOT_FOUND', status: 404 }) })
  row.status = status
  const own = db.accounts.find((a) => a.id === id)
  if (own) own.status = status
  return delay(clone({ currency: 'INR', ...row }))
}

// ---------------------------------------------------------------- transactions
function withAccountIds(t) {
  return { currency: 'INR', accountIds: [t.accountId], reference: t.id, ...t }
}

export function listTransactions() {
  return delay(db.transactions.map(withAccountIds).map(clone))
}

export function listAllTransactions() {
  const owner = (id) => db.adminAccounts.find((a) => a.id === id)?.customer || db.accounts.find((a) => a.id === id)?.name || '—'
  return delay(db.transactions.map((t) => ({ ...withAccountIds(t), customer: owner(t.accountId) })).map(clone))
}

export function transfer({ sourceAccountId, destinationAccountId, amount, currency, description }) {
  const source = db.accounts.find((a) => a.id === sourceAccountId)
  const dest = db.accounts.find((a) => a.id === destinationAccountId)
  const value = Number(amount)
  if (!source) return delay(null).then(() => { throw new ApiError('Source account not found', { code: 'ACCOUNT_NOT_FOUND', status: 404 }) })
  if (sourceAccountId === destinationAccountId) {
    return delay(null).then(() => {
      throw new ApiError('Validation failed', { code: 'VALIDATION_ERROR', status: 400, details: { destinationAccountId: 'must differ from the source account' } })
    })
  }

  let outcome = 'COMPLETED'
  let failureReason = null
  if (!dest) { outcome = 'FAILED'; failureReason = 'Destination account not found' }
  else if (source.type !== 'Credit' && value > source.available) { outcome = 'FAILED'; failureReason = 'Insufficient funds' }
  else if (value > 100000) { outcome = 'UNDER_REVIEW'; failureReason = null }

  const id = nextId('txn')
  const createdAt = new Date().toISOString()
  db.transfers[id] = { createdAt: Date.now(), outcome, failureReason, applied: false }
  db.transactions.unshift({
    id,
    accountId: sourceAccountId,
    date: createdAt,
    description: description || `Transfer to ${dest?.name || destinationAccountId}`,
    category: 'Transfer',
    amount: -value,
    type: dest ? 'internal' : 'debit',
    status: 'Pending',
    currency: currency || source.currency,
    sourceAccountId,
    destinationAccountId,
  })
  return delay({ id, reference: id.toUpperCase(), status: 'PENDING', amount: value, currency: currency || source.currency }, 300)
}

const STATUS_LABEL = { PENDING: 'Pending', PROCESSING: 'Processing', COMPLETED: 'Completed', FAILED: 'Failed', UNDER_REVIEW: 'Under Review' }

export function getTransactionStatus(id) {
  const t = db.transfers[id]
  if (!t) return delay(null).then(() => { throw new ApiError('Transaction not found', { code: 'TRANSACTION_NOT_FOUND', status: 404 }) })
  const elapsed = Date.now() - t.createdAt
  const at = (ms) => new Date(t.createdAt + ms).toISOString()
  const history = [{ fromStatus: null, toStatus: 'PENDING', reason: 'Transfer requested', changedAt: at(0) }]
  let status = 'PENDING'
  if (elapsed > 1200) {
    if (t.outcome === 'UNDER_REVIEW') {
      status = 'UNDER_REVIEW'
      history.push({ fromStatus: 'PENDING', toStatus: 'UNDER_REVIEW', reason: 'Flagged by fraud checks (HIGH risk)', changedAt: at(1200) })
    } else {
      status = 'PROCESSING'
      history.push({ fromStatus: 'PENDING', toStatus: 'PROCESSING', reason: 'Fraud check passed', changedAt: at(1200) })
    }
  }
  if (elapsed > 2600 && t.outcome !== 'UNDER_REVIEW') {
    status = t.outcome
    history.push({ fromStatus: 'PROCESSING', toStatus: t.outcome, reason: t.failureReason || 'Balances updated', changedAt: at(2600) })
  }

  const row = db.transactions.find((x) => x.id === id)
  if (row) row.status = STATUS_LABEL[status]
  if (status === 'COMPLETED' && !t.applied && row) {
    t.applied = true
    const src = db.accounts.find((a) => a.id === row.sourceAccountId)
    const dst = db.accounts.find((a) => a.id === row.destinationAccountId)
    const value = Math.abs(row.amount)
    if (src) { src.balance -= value; src.available -= value }
    if (dst) { dst.balance += value; dst.available += value }
  }

  return delay({ transactionId: id, reference: id.toUpperCase(), status, failureReason: status === 'FAILED' ? t.failureReason : null, history }, 150)
}

// ---------------------------------------------------------------- notifications
export function listNotifications() {
  return delay(clone(db.notifications))
}

export function markNotificationRead(id) {
  const n = db.notifications.find((x) => x.id === id)
  if (n) n.read = true
  return delay(n ? clone(n) : null, 100)
}

// ---------------------------------------------------------------- fraud
export function listFraudAlerts() {
  return delay(clone(db.fraudAlerts))
}

export function reviewFraudAlert(id, decision, notes) {
  const a = db.fraudAlerts.find((x) => x.id === id)
  if (!a) return delay(null).then(() => { throw new ApiError('Fraud alert not found', { code: 'FRAUD_ALERT_NOT_FOUND', status: 404 }) })
  a.status = decision === 'APPROVE' ? 'Approved' : 'Rejected'
  a.reviewedBy = 'ADMIN-1'
  a.reviewNotes = notes || null
  a.reviewedAt = new Date().toISOString()
  return delay(clone(a), 300)
}

// ---------------------------------------------------------------- audit + system
export function listAuditLogs() {
  return delay(clone(db.auditLog.map((l) => ({ severity: 'INFO', ...l }))))
}

export function getSystemHealth() {
  const allUp = db.services.every((s) => s.status === 'Operational')
  return delay({ status: allUp ? 'UP' : 'DEGRADED', services: clone(db.services) })
}

// ---------------------------------------------------------------- dashboards
export function adminOverview() {
  const statusCounts = {}
  db.transactions.forEach((t) => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1 })
  return delay({
    metrics: {
      customers: seed.adminMetrics.totalCustomers,
      accounts: seed.adminMetrics.totalAccounts,
      transactions24h: seed.adminMetrics.transactionsToday,
      volume24h: seed.adminMetrics.transactionVolumeToday,
      openFraud: db.fraudAlerts.filter((a) => a.status === 'Open').length,
      underReview: statusCounts['Under Review'] || 0,
    },
    currency: 'INR',
    hourlyVolume: clone(seed.platformTxnVolume),
    services: clone(db.services),
    openAlerts: clone(db.fraudAlerts.filter((a) => a.status === 'Open')),
    statusBreakdown: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
    sampleNote: 'Mock data',
    errors: [],
  })
}

export function balanceTrend() {
  return clone(seed.balanceTrend)
}

export function spendingByCategory() {
  return clone(seed.spendingByCategory)
}

// Shared in-memory state, for feature-specific mock modules (src/services/mock/*Mock.js)
// that need to read or change the same data as the functions above.
export { db, clone, nextId }
