// -----------------------------------------------------------------------------
// Mock data for the banking platform frontend.
// This stands in for the (not-yet-built) microservice APIs. Everything the UI
// renders comes from here so the app runs standalone. Swap these exports for
// real API calls later without touching the components.
// -----------------------------------------------------------------------------

export const currentUser = {
  id: 'u_10023',
  name: 'Ava Mitchell',
  email: 'ava.mitchell@example.com',
  since: '2019-03-14',
  tier: 'Premier',
}

export const adminUser = {
  id: 'a_2001',
  name: 'Devon Ellis',
  email: 'devon.ellis@meridian.internal',
  role: 'Operations Lead',
}

// --- Customer: accounts --------------------------------------------------------
export const accounts = [
  {
    id: 'acc_chk_01',
    name: 'Everyday Checking',
    type: 'Checking',
    number: '**** 4021',
    balance: 8452.19,
    available: 8452.19,
    currency: 'USD',
    status: 'Active',
  },
  {
    id: 'acc_sav_01',
    name: 'High-Yield Savings',
    type: 'Savings',
    number: '**** 7788',
    balance: 42890.55,
    available: 42890.55,
    currency: 'USD',
    apy: 4.35,
    status: 'Active',
  },
  {
    id: 'acc_crd_01',
    name: 'Meridian Platinum Card',
    type: 'Credit',
    number: '**** 1140',
    balance: -1284.72,
    available: 13715.28,
    limit: 15000,
    currency: 'USD',
    status: 'Active',
  },
]

// --- Customer: transactions ----------------------------------------------------
export const transactions = [
  { id: 'txn_9001', accountId: 'acc_chk_01', date: '2026-07-18', description: 'Whole Foods Market', category: 'Groceries', amount: -86.24, type: 'debit', status: 'Posted' },
  { id: 'txn_9002', accountId: 'acc_chk_01', date: '2026-07-18', description: 'Payroll — Northwind Inc', category: 'Income', amount: 3120.0, type: 'credit', status: 'Posted' },
  { id: 'txn_9003', accountId: 'acc_crd_01', date: '2026-07-17', description: 'Amazon.com', category: 'Shopping', amount: -142.9, type: 'debit', status: 'Posted' },
  { id: 'txn_9004', accountId: 'acc_chk_01', date: '2026-07-17', description: 'Shell Gas Station', category: 'Transport', amount: -54.11, type: 'debit', status: 'Posted' },
  { id: 'txn_9005', accountId: 'acc_sav_01', date: '2026-07-16', description: 'Interest Payment', category: 'Interest', amount: 151.32, type: 'credit', status: 'Posted' },
  { id: 'txn_9006', accountId: 'acc_crd_01', date: '2026-07-16', description: 'Delta Air Lines', category: 'Travel', amount: -612.4, type: 'debit', status: 'Pending' },
  { id: 'txn_9007', accountId: 'acc_chk_01', date: '2026-07-15', description: 'Con Edison — Utilities', category: 'Bills', amount: -128.75, type: 'debit', status: 'Posted' },
  { id: 'txn_9008', accountId: 'acc_chk_01', date: '2026-07-15', description: 'Transfer to Savings', category: 'Transfer', amount: -1000.0, type: 'debit', status: 'Posted' },
  { id: 'txn_9009', accountId: 'acc_sav_01', date: '2026-07-15', description: 'Transfer from Checking', category: 'Transfer', amount: 1000.0, type: 'credit', status: 'Posted' },
  { id: 'txn_9010', accountId: 'acc_crd_01', date: '2026-07-14', description: 'Blue Bottle Coffee', category: 'Dining', amount: -9.5, type: 'debit', status: 'Posted' },
  { id: 'txn_9011', accountId: 'acc_chk_01', date: '2026-07-13', description: 'Spotify Premium', category: 'Subscriptions', amount: -11.99, type: 'debit', status: 'Posted' },
  { id: 'txn_9012', accountId: 'acc_crd_01', date: '2026-07-12', description: 'Uber Trip', category: 'Transport', amount: -23.8, type: 'debit', status: 'Posted' },
  { id: 'txn_9013', accountId: 'acc_chk_01', date: '2026-07-11', description: 'Venmo — Jordan P.', category: 'Transfer', amount: -45.0, type: 'debit', status: 'Posted' },
  { id: 'txn_9014', accountId: 'acc_chk_01', date: '2026-07-10', description: 'Apple Store', category: 'Shopping', amount: -329.0, type: 'debit', status: 'Posted' },
  { id: 'txn_9015', accountId: 'acc_sav_01', date: '2026-07-09', description: 'Mobile Deposit', category: 'Income', amount: 500.0, type: 'credit', status: 'Posted' },
]

// Spending breakdown for the customer dashboard (last 30 days)
export const spendingByCategory = [
  { category: 'Shopping', amount: 811.9 },
  { category: 'Travel', amount: 612.4 },
  { category: 'Bills', amount: 257.5 },
  { category: 'Groceries', amount: 214.6 },
  { category: 'Transport', amount: 132.71 },
  { category: 'Dining', amount: 88.2 },
]

// 12-week balance trend for the dashboard chart
export const balanceTrend = [
  41200, 40850, 42010, 41780, 43050, 44120, 43600, 44980, 46100, 45720, 50100, 51342,
]

export const notifications = [
  { id: 'n_01', type: 'security', title: 'New device signed in', message: 'A new sign-in from Chrome on macOS was detected.', date: '2026-07-18T09:12:00', read: false },
  { id: 'n_02', type: 'transaction', title: 'Large purchase posted', message: 'A $612.40 charge to Delta Air Lines is pending review.', date: '2026-07-16T14:40:00', read: false },
  { id: 'n_03', type: 'account', title: 'Interest paid', message: 'You earned $151.32 in interest on High-Yield Savings.', date: '2026-07-16T00:05:00', read: true },
  { id: 'n_04', type: 'promo', title: 'Your APY increased', message: 'High-Yield Savings APY is now 4.35%.', date: '2026-07-10T11:00:00', read: true },
]

// --- Admin: platform metrics ---------------------------------------------------
export const adminMetrics = {
  totalCustomers: 48213,
  totalAccounts: 91764,
  transactionsToday: 128940,
  transactionVolumeToday: 18432190.55,
  openFraudCases: 37,
  avgApprovalLatencyMs: 84,
}

// Transactions per hour across the platform (last 24h, admin dashboard chart)
export const platformTxnVolume = [
  620, 410, 300, 260, 240, 300, 520, 980, 1640, 2100, 2380, 2450, 2510, 2460, 2380,
  2290, 2410, 2600, 2540, 2180, 1720, 1280, 940, 720,
]

// --- Admin: fraud alerts -------------------------------------------------------
export const fraudAlerts = [
  { id: 'fr_5001', txnId: 'txn_88123', customer: 'Marcus Reed', accountNumber: '**** 9921', amount: 4200.0, riskScore: 94, reason: 'Unusual location + high amount', status: 'Open', createdAt: '2026-07-19T07:41:00' },
  { id: 'fr_5002', txnId: 'txn_88090', customer: 'Priya Nair', accountNumber: '**** 3310', amount: 899.99, riskScore: 81, reason: 'Card-not-present velocity', status: 'Reviewing', createdAt: '2026-07-19T06:58:00' },
  { id: 'fr_5003', txnId: 'txn_87740', customer: 'Ava Mitchell', accountNumber: '**** 1140', amount: 612.4, riskScore: 63, reason: 'First-time merchant, travel', status: 'Reviewing', createdAt: '2026-07-16T14:41:00' },
  { id: 'fr_5004', txnId: 'txn_87001', customer: 'Leo Tanaka', accountNumber: '**** 5567', amount: 12500.0, riskScore: 97, reason: 'Structuring pattern detected', status: 'Blocked', createdAt: '2026-07-18T22:10:00' },
  { id: 'fr_5005', txnId: 'txn_86550', customer: 'Sofia Ramos', accountNumber: '**** 2204', amount: 78.35, riskScore: 44, reason: 'Mismatched billing ZIP', status: 'Cleared', createdAt: '2026-07-18T19:03:00' },
  { id: 'fr_5006', txnId: 'txn_86210', customer: 'Elena Fischer', accountNumber: '**** 7781', amount: 2650.0, riskScore: 88, reason: 'Account takeover signals', status: 'Open', createdAt: '2026-07-19T05:22:00' },
]

// --- Admin: audit log ----------------------------------------------------------
export const auditLog = [
  { id: 'au_7001', timestamp: '2026-07-19T08:03:11', service: 'account-service', actor: 'system', action: 'ACCOUNT_OPENED', entity: 'acc_chk_92841', detail: 'New checking account provisioned' },
  { id: 'au_7002', timestamp: '2026-07-19T08:01:47', service: 'transaction-service', actor: 'u_10023', action: 'TRANSFER_INITIATED', entity: 'txn_9008', detail: '$1,000.00 Checking → Savings' },
  { id: 'au_7003', timestamp: '2026-07-19T07:59:02', service: 'fraud-service', actor: 'system', action: 'RISK_SCORED', entity: 'txn_88123', detail: 'Score 94 — flagged for review' },
  { id: 'au_7004', timestamp: '2026-07-19T07:55:33', service: 'audit-service', actor: 'a_2001', action: 'CASE_ASSIGNED', entity: 'fr_5002', detail: 'Assigned to analyst queue' },
  { id: 'au_7005', timestamp: '2026-07-19T07:50:18', service: 'notification-service', actor: 'system', action: 'NOTIFICATION_SENT', entity: 'n_02', detail: 'Push: large purchase pending' },
  { id: 'au_7006', timestamp: '2026-07-19T07:44:59', service: 'api-gateway', actor: 'u_44120', action: 'AUTH_LOGIN', entity: 'session_7f3a', detail: 'JWT issued, MFA verified' },
  { id: 'au_7007', timestamp: '2026-07-19T07:40:12', service: 'transaction-service', actor: 'u_44120', action: 'PAYMENT_POSTED', entity: 'txn_88090', detail: '$899.99 card purchase' },
  { id: 'au_7008', timestamp: '2026-07-19T07:31:05', service: 'account-service', actor: 'a_2001', action: 'ACCOUNT_FROZEN', entity: 'acc_crd_5567', detail: 'Frozen pending fraud review' },
]

// --- Admin: service health -----------------------------------------------------
export const services = [
  { name: 'api-gateway', status: 'Operational', uptime: 99.99, latencyMs: 22, version: '1.4.2', instances: 4 },
  { name: 'account-service', status: 'Operational', uptime: 99.98, latencyMs: 41, version: '1.4.0', instances: 3 },
  { name: 'transaction-service', status: 'Operational', uptime: 99.95, latencyMs: 58, version: '1.4.1', instances: 6 },
  { name: 'fraud-service', status: 'Degraded', uptime: 99.62, latencyMs: 210, version: '1.3.9', instances: 3 },
  { name: 'audit-service', status: 'Operational', uptime: 99.97, latencyMs: 33, version: '1.2.7', instances: 2 },
  { name: 'notification-service', status: 'Operational', uptime: 99.9, latencyMs: 47, version: '1.3.1', instances: 2 },
]

// Kafka / event pipeline snapshot for the admin dashboard
export const eventPipeline = [
  { topic: 'account.created', lag: 0, throughput: 42 },
  { topic: 'transaction.initiated', lag: 128, throughput: 910 },
  { topic: 'fraud.decision', lag: 1240, throughput: 880 },
  { topic: 'notification.requested', lag: 12, throughput: 305 },
]

// --- Admin: customer directory -------------------------------------------------
export const adminAccounts = [
  { id: 'acc_chk_01', customer: 'Ava Mitchell', type: 'Checking', number: '**** 4021', balance: 8452.19, status: 'Active', opened: '2019-03-14' },
  { id: 'acc_sav_88', customer: 'Marcus Reed', type: 'Savings', number: '**** 9921', balance: 15230.0, status: 'Active', opened: '2021-06-02' },
  { id: 'acc_crd_31', customer: 'Priya Nair', type: 'Credit', number: '**** 3310', balance: -2210.5, status: 'Active', opened: '2020-11-19' },
  { id: 'acc_chk_55', customer: 'Leo Tanaka', type: 'Checking', number: '**** 5567', balance: 340.12, status: 'Frozen', opened: '2022-01-30' },
  { id: 'acc_sav_22', customer: 'Sofia Ramos', type: 'Savings', number: '**** 2204', balance: 61200.0, status: 'Active', opened: '2018-09-08' },
  { id: 'acc_crd_77', customer: 'Elena Fischer', type: 'Credit', number: '**** 7781', balance: -540.0, status: 'Under Review', opened: '2023-04-11' },
  { id: 'acc_chk_90', customer: 'Noah Bennett', type: 'Checking', number: '**** 6642', balance: 2210.75, status: 'Active', opened: '2024-02-22' },
  { id: 'acc_sav_45', customer: 'Grace Liu', type: 'Savings', number: '**** 8830', balance: 9875.4, status: 'Dormant', opened: '2017-07-15' },
]
