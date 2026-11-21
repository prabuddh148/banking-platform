// account-service: /api/v1/accounts
import { api, pageContent } from '../lib/api.js'
import { API_V1, USE_MOCK } from '../lib/config.js'
import { humanize, maskAccountNumber, toNumber, currencyOf, isAdminUser } from './mappers.js'
import * as mock from './mock/mockStore.js'

const BASE = `${API_V1}/accounts`

/**
 * AccountResponse / AccountSummaryResponse -> UI account
 * { id, name, type, number (masked), accountNumber, balance, available, currency,
 *   status ('Active' | 'Frozen' | 'Closed'), rawStatus, customer, customerId, opened }
 */
export function mapAccount(dto) {
  const type = humanize(dto.accountType) || 'Account'
  const balance = toNumber(dto.balance) ?? toNumber(dto.ledgerBalance) ?? 0
  return {
    id: dto.id,
    name: `${type} Account`,
    type,
    rawType: dto.accountType,
    accountNumber: dto.accountNumber,
    number: maskAccountNumber(dto.accountNumber),
    balance,
    available: toNumber(dto.availableBalance) ?? balance,
    currency: currencyOf(dto),
    status: humanize(dto.status) || 'Active',
    rawStatus: dto.status,
    customer: dto.customerName || '—',
    customerId: dto.customerId,
    customerEmail: dto.customerEmail,
    opened: dto.createdAt || null,
  }
}

/** The logged-in user's own accounts (with available balance). */
export async function listMyAccounts(user) {
  if (USE_MOCK) return mock.listAccounts()

  // Admins see ALL accounts on GET /accounts, so scope it to their own customerId.
  const query = { page: 0, size: 100 }
  if (isAdminUser(user)) query.customerId = user.userId
  const summaries = pageContent(await api.get(BASE, { query }))

  // The summary has no availableBalance; fetch details (a customer has only a few accounts).
  const detailed = await Promise.allSettled(summaries.map((s) => api.get(`${BASE}/${s.id}`)))
  return summaries.map((s, i) => mapAccount(detailed[i].status === 'fulfilled' ? detailed[i].value : s))
}

/** Admin: every account on the platform (first 100), optional status filter. */
export async function listAllAccounts({ status } = {}) {
  if (USE_MOCK) {
    const items = await mock.listAllAccounts()
    return { items, total: items.length }
  }
  const page = await api.get(BASE, { query: { page: 0, size: 100, status } })
  return { items: pageContent(page).map(mapAccount), total: page?.totalElements ?? pageContent(page).length }
}

/** CreateAccountRequest -> 201 AccountResponse */
export async function openAccount(form) {
  const body = {
    customerName: form.customerName,
    customerEmail: form.customerEmail,
    customerPhone: form.customerPhone || undefined,
    accountType: form.accountType,
    currency: form.currency || 'INR',
    initialDeposit: Number(form.initialDeposit) || 0,
  }
  if (USE_MOCK) return mock.openAccount(body)
  return mapAccount(await api.post(BASE, body))
}

export async function freezeAccount(id, reason) {
  if (USE_MOCK) return mock.setAccountStatus(id, 'Frozen')
  return mapAccount(await api.post(`${BASE}/${id}/freeze`, { reason: reason || 'Frozen by admin' }))
}

export async function unfreezeAccount(id, reason) {
  if (USE_MOCK) return mock.setAccountStatus(id, 'Active')
  return mapAccount(await api.post(`${BASE}/${id}/unfreeze`, { reason: reason || 'Unfrozen by admin' }))
}
