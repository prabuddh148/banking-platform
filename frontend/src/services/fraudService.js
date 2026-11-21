// fraud-service: /api/v1/fraud (admin only)
import { api, pageContent } from '../lib/api.js'
import { API_V1, USE_MOCK } from '../lib/config.js'
import { humanize, toNumber, currencyOf, shortId } from './mappers.js'
import * as mock from './mock/mockStore.js'

const BASE = `${API_V1}/fraud`

/**
 * FraudAlertResponse -> UI alert
 * { id, txnId, accountId, customer, accountNumber, amount, currency, riskScore, riskLevel,
 *   triggeredRules, reason, status ('Open'|'Approved'|'Rejected'), reviewedBy, reviewNotes, createdAt }
 */
export function mapAlert(dto, accountLookup) {
  const account = accountLookup?.get(dto.accountId)
  const rules = Array.isArray(dto.triggeredRules) ? dto.triggeredRules : []
  return {
    id: dto.id,
    txnId: dto.transactionId,
    accountId: dto.accountId,
    customer: account?.customer || `Account ${shortId(dto.accountId)}`,
    accountNumber: account?.number || shortId(dto.accountId),
    amount: toNumber(dto.amount) || 0,
    currency: currencyOf(dto),
    riskScore: toNumber(dto.riskScore) || 0,
    riskLevel: dto.riskLevel,
    triggeredRules: rules,
    reason: dto.reason || rules.join(', ') || 'Flagged by fraud rules',
    status: humanize(dto.status) || 'Open',
    reviewedBy: dto.reviewedBy,
    reviewNotes: dto.reviewNotes,
    createdAt: dto.createdAt,
    reviewedAt: dto.reviewedAt,
  }
}

/** All alerts (latest 100). `accounts` (optional, admin list) resolves customer names. */
export async function listAlerts({ status, accounts } = {}) {
  if (USE_MOCK) return mock.listFraudAlerts()
  const lookup = new Map((accounts || []).map((a) => [a.id, a]))
  const page = await api.get(`${BASE}/alerts`, { query: { page: 0, size: 100, status } })
  return pageContent(page).map((a) => mapAlert(a, lookup))
}

/** decision: 'APPROVE' (release the transaction) | 'REJECT' (block it) */
export async function reviewAlert(id, decision, notes) {
  if (USE_MOCK) return mock.reviewFraudAlert(id, decision, notes)
  return mapAlert(await api.post(`${BASE}/alerts/${id}/review`, { decision, notes: notes || undefined }))
}
