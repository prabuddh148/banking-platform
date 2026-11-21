// Customer-side mock behaviour that the shared mockStore doesn't cover:
//  - transfers to OTHER customers' accounts (saved payees such as Priya Patel)
//  - deposits ("Add money")
//  - looking up a payee by account id
// It reuses the same in-memory db, so balances, the transaction list and the
// saga status endpoint (mockStore.getTransactionStatus) all stay consistent.
import { db, clone, nextId, delay } from './mockStore.js'
import * as store from './mockStore.js'
import { ApiError } from '../../lib/api.js'

/** Other Meridian customers' accounts (from the admin directory), by id. */
function externalAccount(id) {
  if (db.accounts.some((a) => a.id === id)) return null
  return db.adminAccounts.find((a) => a.id === id) || null
}

/** Payee preview for an account id: { id, name, number, type, status } or null. */
export function lookupAccount(id) {
  const own = db.accounts.find((a) => a.id === id)
  const ext = externalAccount(id)
  const acc = own || ext
  if (!acc) return delay(null, 200)
  return delay({ id: acc.id, name: own ? acc.name : acc.customer, number: acc.number, type: acc.type, status: acc.status, own: Boolean(own) }, 200)
}

/**
 * POST /transactions/transfer. Own-account and unknown destinations use the shared
 * mock; other customers' accounts are handled here so the saga can complete.
 */
export function transfer(body) {
  const ext = externalAccount(body.destinationAccountId)
  if (!ext) return store.transfer(body)

  const source = db.accounts.find((a) => a.id === body.sourceAccountId)
  const value = Number(body.amount)
  if (!source) return delay(null).then(() => { throw new ApiError('Source account not found', { code: 'ACCOUNT_NOT_FOUND', status: 404 }) })

  let outcome = 'COMPLETED'
  let failureReason = null
  if (ext.status !== 'Active') { outcome = 'FAILED'; failureReason = `Destination account is ${String(ext.status).toLowerCase()}` }
  else if (value > source.available) { outcome = 'FAILED'; failureReason = 'Insufficient funds' }
  else if (value > 100000) outcome = 'UNDER_REVIEW'

  const id = nextId('txn')
  const createdAt = new Date().toISOString()
  db.transfers[id] = { createdAt: Date.now(), outcome, failureReason, applied: false }
  db.transactions.unshift({
    id,
    accountId: body.sourceAccountId,
    date: createdAt,
    description: body.description || `Transfer to ${ext.customer}`,
    category: 'Transfer',
    amount: -value,
    type: 'debit',
    status: 'Pending',
    channel: 'IMPS',
    reference: id.toUpperCase(),
    currency: body.currency || source.currency,
    sourceAccountId: body.sourceAccountId,
    destinationAccountId: body.destinationAccountId,
  })
  if (outcome === 'COMPLETED') {
    // credit the payee once the saga settles (the shared mock only knows own accounts)
    setTimeout(() => { if (db.transfers[id]) ext.balance += value }, 2700)
  }
  return delay({ id, reference: id.toUpperCase(), status: 'PENDING', amount: value, currency: body.currency || source.currency }, 300)
}

/** POST /transactions/deposit -> 202 { id, status: PENDING }; completes through the same saga timeline. */
export function deposit({ accountId, amount, currency, description }) {
  const acc = db.accounts.find((a) => a.id === accountId)
  if (!acc) return delay(null).then(() => { throw new ApiError('Account not found', { code: 'ACCOUNT_NOT_FOUND', status: 404 }) })
  const value = Number(amount)
  const id = nextId('txn')
  db.transfers[id] = { createdAt: Date.now(), outcome: value > 100000 ? 'UNDER_REVIEW' : 'COMPLETED', failureReason: null, applied: false }
  db.transactions.unshift({
    id,
    accountId,
    date: new Date().toISOString(),
    description: description || 'Cash deposit',
    category: 'Deposit',
    amount: value,
    type: 'credit',
    status: 'Pending',
    channel: 'Deposit',
    reference: id.toUpperCase(),
    currency: currency || acc.currency,
    destinationAccountId: accountId,
  })
  return delay(clone({ id, reference: id.toUpperCase(), status: 'PENDING', amount: value, currency: currency || acc.currency }), 300)
}
