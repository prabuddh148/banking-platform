// transaction-service: /api/v1/transactions
import { api, pageContent, newIdempotencyKey } from '../lib/api.js'
import { API_V1, USE_MOCK } from '../lib/config.js'
import { humanize, toNumber, currencyOf } from './mappers.js'
import * as mock from './mock/mockStore.js'
import * as customerMock from './mock/customerMock.js'

const BASE = `${API_V1}/transactions`

/** Saga states after which there is nothing more to wait for. */
export const FINAL_STATUSES = ['COMPLETED', 'FAILED', 'UNDER_REVIEW']

/**
 * TransactionResponse -> UI transaction
 * { id, reference, date, description, category, amount (signed), type ('credit'|'debit'|'internal'),
 *   status ('Pending'|'Processing'|'Under Review'|'Completed'|'Failed'), currency, accountIds,
 *   sourceAccountId, destinationAccountId, transactionType, failureReason, riskScore, customer }
 *
 * `ownAccountIds` (a Set) decides the direction from the customer's point of view;
 * without it (admin views) deposits are credits, withdrawals debits and transfers neutral.
 */
export function mapTransaction(dto, { ownAccountIds, accountLookup } = {}) {
  const kind = dto.transactionType
  const amount = Math.abs(toNumber(dto.amount) || 0)
  let type = 'internal'
  let category = humanize(kind) || 'Transaction'

  if (kind === 'DEPOSIT') type = 'credit'
  else if (kind === 'WITHDRAWAL') type = 'debit'
  else if (ownAccountIds) {
    const fromMine = ownAccountIds.has(dto.sourceAccountId)
    const toMine = ownAccountIds.has(dto.destinationAccountId)
    if (fromMine && toMine) type = 'internal'
    else if (toMine) { type = 'credit'; category = 'Transfer in' }
    else { type = 'debit'; category = 'Transfer out' }
  }

  const owner = accountLookup?.get(dto.sourceAccountId) || accountLookup?.get(dto.destinationAccountId)

  return {
    id: dto.id,
    reference: dto.reference || dto.id,
    date: dto.createdAt,
    completedAt: dto.completedAt,
    description: dto.description || `${humanize(kind)} ${dto.reference || ''}`.trim(),
    category,
    amount: type === 'credit' ? amount : -amount,
    type,
    status: humanize(dto.status) || 'Pending',
    rawStatus: dto.status,
    currency: currencyOf(dto),
    accountIds: [dto.sourceAccountId, dto.destinationAccountId].filter(Boolean),
    sourceAccountId: dto.sourceAccountId,
    destinationAccountId: dto.destinationAccountId,
    transactionType: kind,
    failureReason: dto.failureReason,
    failureCode: dto.failureCode,
    riskScore: toNumber(dto.riskScore),
    initiatedBy: dto.initiatedBy,
    customer: owner?.customer || dto.initiatedBy || '—',
  }
}

/** Transactions the customer initiated or that touch their accounts. */
export async function listMyTransactions(accounts = []) {
  if (USE_MOCK) return mock.listTransactions()

  const ownAccountIds = new Set(accounts.map((a) => a.id))
  const page = await api.get(BASE, { query: { page: 0, size: 100 } })
  const own = pageContent(page)

  // Incoming transfers are only returned when asking per account.
  const perAccount = await Promise.allSettled(
    accounts.map((a) => api.get(BASE, { query: { page: 0, size: 50, accountId: a.id } })),
  )
  const byId = new Map(own.map((t) => [t.id, t]))
  perAccount.forEach((r) => r.status === 'fulfilled' && pageContent(r.value).forEach((t) => byId.set(t.id, t)))

  // Admins get every transaction from GET /transactions; keep only ones touching their accounts.
  return [...byId.values()]
    .filter((t) => ownAccountIds.size === 0 || ownAccountIds.has(t.sourceAccountId) || ownAccountIds.has(t.destinationAccountId))
    .map((t) => mapTransaction(t, { ownAccountIds }))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

/** Admin: platform-wide feed (latest 100). `accounts` (optional) adds customer names. */
export async function listAllTransactions({ status, type, accounts } = {}) {
  if (USE_MOCK) {
    const items = await mock.listAllTransactions()
    return { items, total: items.length }
  }
  const accountLookup = new Map((accounts || []).map((a) => [a.id, a]))
  const page = await api.get(BASE, { query: { page: 0, size: 100, status, type } })
  return {
    items: pageContent(page).map((t) => mapTransaction(t, { accountLookup })),
    total: page?.totalElements ?? pageContent(page).length,
  }
}

/**
 * POST /transfer -> 202 TransactionResponse (status PENDING; the saga runs asynchronously).
 * Pass the same `idempotencyKey` when retrying one submission so it is never applied twice
 * (a fresh key is generated when none is given).
 */
export async function transfer({ sourceAccountId, destinationAccountId, amount, currency, description, idempotencyKey }) {
  const body = {
    sourceAccountId,
    destinationAccountId,
    amount: Number(amount),
    currency: currency || 'INR',
    description: description || undefined,
  }
  if (USE_MOCK) return customerMock.transfer(body)
  return api.post(`${BASE}/transfer`, body, { headers: { 'Idempotency-Key': idempotencyKey || newIdempotencyKey() } })
}

/** POST /deposit -> 202 TransactionResponse ("Add money"; runs through the same saga, minus the source checks). */
export async function deposit({ accountId, amount, currency, description, idempotencyKey }) {
  const body = { accountId, amount: Number(amount), currency: currency || 'INR', description: description || undefined }
  if (USE_MOCK) return customerMock.deposit(body)
  return api.post(`${BASE}/deposit`, body, { headers: { 'Idempotency-Key': idempotencyKey || newIdempotencyKey() } })
}

/** GET /{id}/status -> { transactionId, reference, status, failureReason, history[] } */
export async function getTransactionStatus(id) {
  if (USE_MOCK) return mock.getTransactionStatus(id)
  return api.get(`${BASE}/${id}/status`)
}

/**
 * Polls the status endpoint until the saga reaches COMPLETED / FAILED / UNDER_REVIEW.
 * Calls onUpdate(status) after each poll. Resolves with the last status
 * (with `timedOut: true` if it never finished within timeoutMs).
 */
export async function pollTransactionStatus(id, { onUpdate, intervalMs = 1500, timeoutMs = 60000, isCancelled } = {}) {
  const started = Date.now()
  let last = null
  while (!isCancelled?.()) {
    try {
      last = await getTransactionStatus(id)
      onUpdate?.(last)
      if (FINAL_STATUSES.includes(last?.status)) return last
    } catch (err) {
      // 404 right after creation can happen if a replica lags; keep trying until timeout.
      if (err?.status && err.status !== 404) throw err
    }
    if (Date.now() - started > timeoutMs) return { ...(last || { transactionId: id }), timedOut: true }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return last
}
