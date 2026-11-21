// -----------------------------------------------------------------------------
// Mock data for the banking platform frontend.
// Only used when VITE_USE_MOCK=true: the services in src/services/ return this
// data (via src/services/mock/mockStore.js) instead of calling the API gateway.
// The shapes here are the "UI shapes" that the real-API mappers also produce.
//
// Everything is generated relative to TODAY with a seeded random generator, so
// the demo always looks fresh and is the same on every reload.
// -----------------------------------------------------------------------------

// Same demo users the api-gateway issues tokens for (see SPEC / README).
export const demoUsers = [
  { username: 'rahul', password: 'password', user: { userId: 'CUST-1001', username: 'rahul', name: 'Rahul Sharma', email: 'rahul.sharma@example.com', roles: ['ROLE_CUSTOMER'] } },
  { username: 'priya', password: 'password', user: { userId: 'CUST-1002', username: 'priya', name: 'Priya Patel', email: 'priya.patel@example.com', roles: ['ROLE_CUSTOMER'] } },
  { username: 'admin', password: 'admin123', user: { userId: 'ADMIN-1', username: 'admin', name: 'Devon Ellis', email: 'admin@meridian.bank', roles: ['ROLE_ADMIN', 'ROLE_CUSTOMER'] } },
]

// ---------------------------------------------------------------- helpers
// Deterministic PRNG (mulberry32) so the "random" demo data is stable.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(20261121)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const between = (min, max) => Math.round((min + rand() * (max - min)) * 100) / 100

const DAY = 86400000
const today = new Date()
today.setHours(12, 0, 0, 0)
const daysAgo = (n, hour = 12, minute = 0) => {
  const d = new Date(today.getTime() - n * DAY)
  d.setHours(hour, minute, 0, 0)
  return d
}
const iso = (d) => d.toISOString()
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString()

// --- Customer: accounts --------------------------------------------------------
export const accounts = [
  {
    id: 'acc_sav_01',
    name: 'Savings Account',
    type: 'Savings',
    accountNumber: 'ACC4829104021',
    number: '**** 4021',
    balance: 284520.45,
    available: 284520.45,
    currency: 'INR',
    status: 'Active',
    interestRate: 3.5,
    ifsc: 'MRDN0001021',
    branch: 'Koramangala, Bengaluru',
    opened: '2019-03-14',
  },
  {
    id: 'acc_cur_01',
    name: 'Salary Account',
    type: 'Current',
    accountNumber: 'ACC7310557788',
    number: '**** 7788',
    balance: 126890.1,
    available: 121890.1,
    currency: 'INR',
    status: 'Active',
    ifsc: 'MRDN0001021',
    branch: 'Koramangala, Bengaluru',
    opened: '2021-07-01',
  },
  {
    id: 'acc_fd_01',
    name: 'Fixed Deposit · 3 yr',
    type: 'Fixed Deposit',
    accountNumber: 'ACC9055121140',
    number: '**** 1140',
    balance: 500000,
    available: 0,
    currency: 'INR',
    status: 'Active',
    interestRate: 7.1,
    maturityDate: iso(daysAgo(-640)),
    ifsc: 'MRDN0001021',
    branch: 'Koramangala, Bengaluru',
    opened: '2025-02-20',
  },
]

// --- Customer: transactions (last ~90 days) ------------------------------------
const MERCHANTS = [
  { description: 'Swiggy', category: 'Food & dining', min: 180, max: 950, channel: 'UPI', weight: 9 },
  { description: 'Zomato', category: 'Food & dining', min: 220, max: 1200, channel: 'UPI', weight: 7 },
  { description: 'Starbucks', category: 'Food & dining', min: 290, max: 640, channel: 'Card', weight: 3 },
  { description: 'BigBasket', category: 'Groceries', min: 900, max: 4200, channel: 'UPI', weight: 5 },
  { description: 'DMart', category: 'Groceries', min: 1200, max: 5200, channel: 'Card', weight: 3 },
  { description: 'Amazon.in', category: 'Shopping', min: 499, max: 7800, channel: 'Card', weight: 5 },
  { description: 'Flipkart', category: 'Shopping', min: 399, max: 12999, channel: 'Card', weight: 3 },
  { description: 'Myntra', category: 'Shopping', min: 899, max: 4500, channel: 'Card', weight: 2 },
  { description: 'Uber', category: 'Transport', min: 140, max: 780, channel: 'UPI', weight: 6 },
  { description: 'Ola', category: 'Transport', min: 120, max: 650, channel: 'UPI', weight: 3 },
  { description: 'HP Petrol Pump', category: 'Transport', min: 1500, max: 3500, channel: 'Card', weight: 3 },
  { description: 'IRCTC', category: 'Travel', min: 650, max: 4800, channel: 'UPI', weight: 2 },
  { description: 'IndiGo Airlines', category: 'Travel', min: 4200, max: 11800, channel: 'Card', weight: 1 },
  { description: 'BookMyShow', category: 'Entertainment', min: 300, max: 1400, channel: 'UPI', weight: 2 },
  { description: 'Apollo Pharmacy', category: 'Health', min: 180, max: 2400, channel: 'UPI', weight: 2 },
  { description: 'Cult.fit', category: 'Health', min: 999, max: 1999, channel: 'Card', weight: 1 },
]
const weighted = MERCHANTS.flatMap((m) => Array(m.weight).fill(m))

function buildTransactions() {
  const list = []
  let seq = 9001
  const add = (daysBack, hour, t) => {
    const date = daysAgo(daysBack, hour, Math.floor(rand() * 60))
    if (date > new Date()) return
    list.push({ id: `txn_${seq++}`, date: iso(date), status: 'Posted', reference: `TXN${date.toISOString().slice(0, 10).replace(/-/g, '')}${Math.floor(rand() * 1e8).toString(36).toUpperCase().padStart(6, '0')}`, ...t })
  }

  for (let back = 92; back >= 0; back--) {
    const d = daysAgo(back)
    const dom = d.getDate()
    // Monthly items
    if (dom === 1) add(back, 9, { accountId: 'acc_cur_01', description: 'Infosys Ltd · Salary', category: 'Income', amount: 145000, type: 'credit', channel: 'NEFT' })
    if (dom === 3) add(back, 10, { accountId: 'acc_cur_01', description: 'Rent · Mr. A. Kapoor', category: 'Rent', amount: -32000, type: 'debit', channel: 'IMPS' })
    if (dom === 5) add(back, 8, { accountId: 'acc_sav_01', description: 'Zerodha Coin · SIP', category: 'Investments', amount: -15000, type: 'debit', channel: 'NACH' })
    if (dom === 5) add(back, 11, { accountId: 'acc_cur_01', description: 'Transfer to Savings', category: 'Transfer', amount: -40000, type: 'internal', channel: 'Internal', sourceAccountId: 'acc_cur_01', destinationAccountId: 'acc_sav_01' })
    if (dom === 7) add(back, 19, { accountId: 'acc_cur_01', description: 'Airtel Postpaid', category: 'Bills & utilities', amount: -899, type: 'debit', channel: 'UPI' })
    if (dom === 9) add(back, 20, { accountId: 'acc_cur_01', description: 'BESCOM Electricity', category: 'Bills & utilities', amount: -between(1400, 2600), type: 'debit', channel: 'UPI' })
    if (dom === 12) add(back, 7, { accountId: 'acc_cur_01', description: 'Netflix', category: 'Subscriptions', amount: -649, type: 'debit', channel: 'Card' })
    if (dom === 15) add(back, 7, { accountId: 'acc_cur_01', description: 'Spotify Premium', category: 'Subscriptions', amount: -119, type: 'debit', channel: 'Card' })
    if (dom === 28) add(back, 6, { accountId: 'acc_sav_01', description: 'Interest credited', category: 'Interest', amount: between(780, 860), type: 'credit', channel: 'Internal' })
    // Day-to-day spending: 0-3 purchases a day
    const count = Math.floor(rand() * 3.2)
    for (let k = 0; k < count; k++) {
      const m = pick(weighted)
      add(back, 9 + Math.floor(rand() * 13), {
        accountId: rand() < 0.75 ? 'acc_cur_01' : 'acc_sav_01',
        description: m.description,
        category: m.category,
        amount: -between(m.min, m.max),
        type: 'debit',
        channel: m.channel,
      })
    }
    // Occasional money from friends
    if (rand() < 0.05) add(back, 21, { accountId: 'acc_sav_01', description: `UPI from ${pick(['Priya P.', 'Arjun M.', 'Neha S.', 'Karan V.'])}`, category: 'Transfer', amount: between(500, 4000), type: 'credit', channel: 'UPI' })
  }

  list.sort((a, b) => new Date(b.date) - new Date(a.date))
  // the two most recent card/UPI payments are still settling
  list.filter((t) => t.channel === 'Card').slice(0, 1).forEach((t) => { t.status = 'Pending' })
  return list
}

export const transactions = buildTransactions()

// Spending breakdown for the customer dashboard (last 30 days, by category)
export const spendingByCategory = (() => {
  const since = Date.now() - 30 * DAY
  const map = {}
  transactions
    .filter((t) => t.type === 'debit' && new Date(t.date).getTime() >= since)
    .forEach((t) => { map[t.category] = (map[t.category] || 0) + Math.abs(t.amount) })
  return Object.entries(map)
    .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
})()

// 12-week total balance trend for the dashboard chart (oldest -> newest)
export const balanceTrend = (() => {
  const total = accounts.reduce((s, a) => s + a.balance, 0)
  const weeks = []
  let running = total
  for (let w = 0; w < 12; w++) {
    weeks.unshift(Math.round(running))
    const from = Date.now() - (w + 1) * 7 * DAY
    const to = Date.now() - w * 7 * DAY
    const net = transactions
      .filter((t) => t.type !== 'internal' && new Date(t.date).getTime() >= from && new Date(t.date).getTime() < to)
      .reduce((s, t) => s + t.amount, 0)
    running -= net
  }
  return weeks
})()

export const notifications = [
  { id: 'n_01', type: 'transaction', title: 'Salary credited', message: '₹1,45,000.00 from Infosys Ltd was credited to your Salary Account (**** 7788).', date: minutesAgo(38), read: false },
  { id: 'n_02', type: 'security', title: 'New sign-in on Chrome · Windows', message: 'If this wasn’t you, freeze your account from the Accounts page.', date: minutesAgo(140), read: false },
  { id: 'n_03', type: 'transaction', title: 'Payment sent', message: '₹899.00 paid to Airtel Postpaid via UPI.', date: minutesAgo(60 * 26), read: false },
  { id: 'n_04', type: 'account', title: 'Interest credited', message: 'You earned ₹812.40 interest on your Savings Account.', date: minutesAgo(60 * 24 * 3), read: true },
  { id: 'n_05', type: 'account', title: 'Fixed Deposit booked', message: 'Your ₹5,00,000 FD at 7.10% p.a. is active. Matures in 21 months.', date: minutesAgo(60 * 24 * 9), read: true },
  { id: 'n_06', type: 'promo', title: 'Pre-approved personal loan', message: 'You’re eligible for up to ₹8,00,000 at 10.49% p.a.', date: minutesAgo(60 * 24 * 14), read: true },
]

// --- Admin: platform metrics ---------------------------------------------------
export const adminMetrics = {
  totalCustomers: 48213,
  totalAccounts: 91764,
  transactionsToday: 128940,
  transactionVolumeToday: 1843219055.5,
  openFraudCases: 4,
  avgApprovalLatencyMs: 84,
}

// Transactions per hour across the platform (last 24h, admin dashboard chart)
export const platformTxnVolume = [
  620, 410, 300, 260, 240, 300, 520, 980, 1640, 2100, 2380, 2450, 2510, 2460, 2380,
  2290, 2410, 2600, 2540, 2180, 1720, 1280, 940, 720,
]

// Daily platform volume for the last 14 days (admin trend chart)
export const platformDailyVolume = Array.from({ length: 14 }, (_, i) => {
  const base = 118000 + i * 900
  const weekend = [0, 6].includes(daysAgo(13 - i).getDay())
  return { date: iso(daysAgo(13 - i)), count: Math.round(base * (weekend ? 0.82 : 1) + between(-4000, 4000)), failed: Math.round(between(180, 420)) }
})

// --- Admin: fraud alerts -------------------------------------------------------
// Same rules as fraud-service: HIGH (60-79) -> REVIEW, alert OPEN; CRITICAL (80+) -> BLOCK,
// alert saved as REJECTED by SYSTEM. Status: Open / Approved / Rejected.
export const fraudAlerts = [
  { id: 'fr_5001', txnId: 'txn_88123', customer: 'Vikram Rao', accountNumber: '**** 9921', amount: 185000, currency: 'INR', riskScore: 65, riskLevel: 'HIGH', triggeredRules: ['AmountThresholdRule', 'GeographicRule'], ruleScores: { AmountThresholdRule: 40, GeographicRule: 25 }, clientCountry: 'AE', transactionType: 'TRANSFER', reason: 'Amount above ₹1,00,000 from outside India (AE)', status: 'Open', createdAt: minutesAgo(12) },
  { id: 'fr_5002', txnId: 'txn_88090', customer: 'Sneha Iyer', accountNumber: '**** 3310', amount: 42999, currency: 'INR', riskScore: 70, riskLevel: 'HIGH', triggeredRules: ['VelocityRule', 'GeographicRule', 'PatternAnomalyRule'], ruleScores: { VelocityRule: 30, GeographicRule: 25, PatternAnomalyRule: 15 }, clientCountry: 'SG', transactionType: 'WITHDRAWAL', reason: '7 transactions in 10 min, unusual country', status: 'Open', createdAt: minutesAgo(47) },
  { id: 'fr_5003', txnId: 'txn_87740', customer: 'Rahul Sharma', accountNumber: '**** 4021', amount: 150000, currency: 'INR', riskScore: 65, riskLevel: 'HIGH', triggeredRules: ['AmountThresholdRule', 'GeographicRule'], ruleScores: { AmountThresholdRule: 40, GeographicRule: 25 }, clientCountry: 'US', transactionType: 'TRANSFER', reason: 'Amount above ₹1,00,000 from outside India (US)', status: 'Open', createdAt: minutesAgo(95) },
  { id: 'fr_5004', txnId: 'txn_87001', customer: 'Arjun Mehta', accountNumber: '**** 5567', amount: 620000, currency: 'INR', riskScore: 95, riskLevel: 'CRITICAL', triggeredRules: ['AmountThresholdRule', 'GeographicRule'], ruleScores: { AmountThresholdRule: 70, GeographicRule: 25 }, clientCountry: 'RU', transactionType: 'TRANSFER', reason: 'Amount above ₹5,00,000 from outside India (RU)', status: 'Rejected', reviewedBy: 'SYSTEM', reviewNotes: 'Automatically blocked (CRITICAL risk)', createdAt: minutesAgo(60 * 5) },
  { id: 'fr_5005', txnId: 'txn_86550', customer: 'Kavya Nair', accountNumber: '**** 2204', amount: 7800, currency: 'INR', riskScore: 60, riskLevel: 'HIGH', triggeredRules: ['VelocityRule', 'PatternAnomalyRule'], ruleScores: { VelocityRule: 30, PatternAnomalyRule: 30 }, clientCountry: 'IN', transactionType: 'TRANSFER', reason: 'Burst of payments at 02:40 IST, 6× usual amount', status: 'Approved', reviewedBy: 'ADMIN-1', reviewNotes: 'Customer confirmed on call', createdAt: minutesAgo(60 * 9) },
  { id: 'fr_5006', txnId: 'txn_86210', customer: 'Rohan Gupta', accountNumber: '**** 7781', amount: 98000, currency: 'INR', riskScore: 75, riskLevel: 'HIGH', triggeredRules: ['VelocityRule', 'GeographicRule', 'PatternAnomalyRule'], ruleScores: { VelocityRule: 30, GeographicRule: 25, PatternAnomalyRule: 20 }, clientCountry: 'GB', transactionType: 'WITHDRAWAL', reason: 'Velocity + foreign IP + 5× average amount', status: 'Open', createdAt: minutesAgo(60 * 2 + 5) },
  { id: 'fr_5007', txnId: 'txn_85990', customer: 'Ananya Das', accountNumber: '**** 6642', amount: 540000, currency: 'INR', riskScore: 90, riskLevel: 'CRITICAL', triggeredRules: ['AmountThresholdRule', 'PatternAnomalyRule'], ruleScores: { AmountThresholdRule: 70, PatternAnomalyRule: 20 }, clientCountry: 'IN', transactionType: 'WITHDRAWAL', reason: 'Above ₹5,00,000 and 9× usual amount', status: 'Rejected', reviewedBy: 'SYSTEM', reviewNotes: 'Automatically blocked (CRITICAL risk)', createdAt: minutesAgo(60 * 20) },
]

// --- Admin: audit log ----------------------------------------------------------
// Mirrors audit-service: one row per Kafka event (type, service, actor, severity).
export const auditLog = [
  { id: 'au_7001', timestamp: minutesAgo(2), service: 'transaction-service', actor: 'CUST-1001', action: 'TRANSACTION_COMPLETED', entity: 'TXN20261121A9K2LQ7M', severity: 'INFO', detail: '₹2,500.00 transfer completed · ACC…4021 → ACC…3310' },
  { id: 'au_7002', timestamp: minutesAgo(2), service: 'account-service', actor: 'system', action: 'BALANCE_UPDATED', entity: 'TXN20261121A9K2LQ7M', severity: 'INFO', detail: 'Debit ₹2,500.00 / credit ₹2,500.00 applied atomically' },
  { id: 'au_7003', timestamp: minutesAgo(3), service: 'fraud-service', actor: 'system', action: 'FRAUD_CLEARED', entity: 'TXN20261121A9K2LQ7M', severity: 'INFO', detail: 'Risk score 0 (LOW) · APPROVE' },
  { id: 'au_7004', timestamp: minutesAgo(3), service: 'transaction-service', actor: 'CUST-1001', action: 'TRANSACTION_INITIATED', entity: 'TXN20261121A9K2LQ7M', severity: 'INFO', detail: 'TRANSFER ₹2,500.00 INR' },
  { id: 'au_7005', timestamp: minutesAgo(12), service: 'fraud-service', actor: 'system', action: 'FRAUD_DETECTED', entity: 'txn_88123', severity: 'WARNING', detail: 'Risk score 65 (HIGH) · REVIEW · AmountThresholdRule, GeographicRule' },
  { id: 'au_7006', timestamp: minutesAgo(31), service: 'account-service', actor: 'ADMIN-1', action: 'ACCOUNT_STATUS_CHANGED', entity: 'ACC…5567', severity: 'WARNING', detail: 'ACTIVE → FROZEN · Suspected account takeover' },
  { id: 'au_7007', timestamp: minutesAgo(58), service: 'account-service', actor: 'CUST-1002', action: 'ACCOUNT_CREATED', entity: 'ACC…3310', severity: 'INFO', detail: 'SAVINGS account opened with ₹25,000.00' },
  { id: 'au_7008', timestamp: minutesAgo(60 * 5), service: 'fraud-service', actor: 'system', action: 'FRAUD_DETECTED', entity: 'txn_87001', severity: 'CRITICAL', detail: 'Risk score 95 (CRITICAL) · BLOCK' },
  { id: 'au_7009', timestamp: minutesAgo(60 * 5), service: 'transaction-service', actor: 'CUST-1044', action: 'TRANSACTION_FAILED', entity: 'txn_87001', severity: 'WARNING', detail: 'FRAUD_BLOCKED · ₹6,20,000.00 transfer' },
  { id: 'au_7010', timestamp: minutesAgo(60 * 7), service: 'account-service', actor: 'system', action: 'BALANCE_UPDATE_FAILED', entity: 'txn_86904', severity: 'WARNING', detail: 'INSUFFICIENT_FUNDS · ACC…6642' },
  { id: 'au_7011', timestamp: minutesAgo(60 * 9), service: 'fraud-service', actor: 'ADMIN-1', action: 'FRAUD_CLEARED', entity: 'txn_86550', severity: 'INFO', detail: 'Manual review: APPROVE · Customer confirmed on call' },
  { id: 'au_7012', timestamp: minutesAgo(60 * 11), service: 'account-service', actor: 'CUST-1001', action: 'ACCOUNT_CREATED', entity: 'ACC…1140', severity: 'INFO', detail: 'FIXED_DEPOSIT account opened with ₹5,00,000.00' },
]

// --- Admin: service health -----------------------------------------------------
export const services = [
  { name: 'api-gateway', status: 'Operational', uptime: 99.99, latencyMs: 18, version: '1.0.0', instances: 2, port: 8080 },
  { name: 'account-service', status: 'Operational', uptime: 99.98, latencyMs: 41, version: '1.0.0', instances: 2, port: 8081 },
  { name: 'transaction-service', status: 'Operational', uptime: 99.97, latencyMs: 52, version: '1.0.0', instances: 3, port: 8082 },
  { name: 'fraud-service', status: 'Operational', uptime: 99.95, latencyMs: 96, version: '1.0.0', instances: 2, port: 8083 },
  { name: 'notification-service', status: 'Operational', uptime: 99.93, latencyMs: 58, version: '1.0.0', instances: 1, port: 8084 },
  { name: 'audit-service', status: 'Operational', uptime: 99.99, latencyMs: 33, version: '1.0.0', instances: 1, port: 8085 },
]

// Kafka topics snapshot (names match the backend)
export const eventPipeline = [
  { topic: 'banking.account.events', lag: 0, throughput: 42, partitions: 3 },
  { topic: 'banking.transaction.events', lag: 128, throughput: 910, partitions: 3 },
  { topic: 'banking.fraud.events', lag: 14, throughput: 880, partitions: 3 },
  { topic: 'banking.notification.events', lag: 3, throughput: 305, partitions: 3 },
]

// --- Admin: customer directory -------------------------------------------------
export const adminAccounts = [
  { id: 'acc_sav_01', customer: 'Rahul Sharma', customerId: 'CUST-1001', type: 'Savings', number: '**** 4021', accountNumber: 'ACC4829104021', balance: 284520.45, currency: 'INR', status: 'Active', opened: '2019-03-14' },
  { id: 'acc_cur_01', customer: 'Rahul Sharma', customerId: 'CUST-1001', type: 'Current', number: '**** 7788', accountNumber: 'ACC7310557788', balance: 126890.1, currency: 'INR', status: 'Active', opened: '2021-07-01' },
  { id: 'acc_sav_31', customer: 'Priya Patel', customerId: 'CUST-1002', type: 'Savings', number: '**** 3310', accountNumber: 'ACC6620143310', balance: 92210.5, currency: 'INR', status: 'Active', opened: '2020-11-19' },
  { id: 'acc_sav_88', customer: 'Vikram Rao', customerId: 'CUST-1017', type: 'Savings', number: '**** 9921', accountNumber: 'ACC5018839921', balance: 415230, currency: 'INR', status: 'Active', opened: '2021-06-02' },
  { id: 'acc_cur_55', customer: 'Arjun Mehta', customerId: 'CUST-1044', type: 'Current', number: '**** 5567', accountNumber: 'ACC3307725567', balance: 3400.12, currency: 'INR', status: 'Frozen', opened: '2022-01-30' },
  { id: 'acc_sav_22', customer: 'Kavya Nair', customerId: 'CUST-1052', type: 'Savings', number: '**** 2204', accountNumber: 'ACC2219962204', balance: 612000, currency: 'INR', status: 'Active', opened: '2018-09-08' },
  { id: 'acc_cur_77', customer: 'Rohan Gupta', customerId: 'CUST-1063', type: 'Current', number: '**** 7781', accountNumber: 'ACC8841207781', balance: 154000, currency: 'INR', status: 'Active', opened: '2023-04-11' },
  { id: 'acc_sav_90', customer: 'Ananya Das', customerId: 'CUST-1071', type: 'Savings', number: '**** 6642', accountNumber: 'ACC4470916642', balance: 22100.75, currency: 'INR', status: 'Active', opened: '2024-02-22' },
  { id: 'acc_fd_45', customer: 'Sneha Iyer', customerId: 'CUST-1080', type: 'Fixed Deposit', number: '**** 8830', accountNumber: 'ACC1192378830', balance: 1000000, currency: 'INR', status: 'Active', opened: '2017-07-15' },
  { id: 'acc_sav_12', customer: 'Karan Verma', customerId: 'CUST-1094', type: 'Savings', number: '**** 1209', accountNumber: 'ACC7713401209', balance: 0, currency: 'INR', status: 'Closed', opened: '2016-05-03' },
]
