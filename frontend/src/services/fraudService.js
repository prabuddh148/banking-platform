// fraud-service: /api/v1/fraud (admin only)
import { api, pageContent } from '../lib/api.js'
import { API_V1, USE_MOCK } from '../lib/config.js'
import { humanize, toNumber, currencyOf, shortId } from './mappers.js'
import * as mock from './mock/mockStore.js'
import * as adminMock from './mock/adminMock.js'

const BASE = `${API_V1}/fraud`

/** The four rules of fraud-service (README §12), for explanations in the UI. */
export const FRAUD_RULES = {
  AmountThresholdRule: { label: 'Amount threshold', description: 'Amount above ₹1,00,000 (+40) or ₹5,00,000 (+70)', max: 70 },
  VelocityRule: { label: 'Velocity', description: 'More than 5 transactions on the account in 10 minutes', max: 30 },
  GeographicRule: { label: 'Geography', description: 'Client country outside the allowed list [IN]', max: 25 },
  PatternAnomalyRule: { label: 'Pattern anomaly', description: '5× the account average (+20) or 00:00–05:00 IST (+10)', max: 30 },
}

/** The API only returns rule names; rebuild each rule's contribution from the documented scores. */
export function deriveRuleScores(rules = [], amount = 0, total = null) {
  const scores = {}
  rules.forEach((r) => {
    if (r === 'AmountThresholdRule') scores[r] = amount > 500000 ? 70 : 40
    else if (r === 'VelocityRule') scores[r] = 30
    else if (r === 'GeographicRule') scores[r] = 25
    else if (r === 'PatternAnomalyRule') scores[r] = 20
    else scores[r] = 0
  })
  // PatternAnomalyRule can be 10, 20 or 30: absorb the difference to match the stored score
  if (total != null && scores.PatternAnomalyRule !== undefined) {
    const rest = Object.entries(scores).filter(([k]) => k !== 'PatternAnomalyRule').reduce((s, [, v]) => s + v, 0)
    const left = Math.min(100, total) - rest
    if ([10, 20, 30].includes(left)) scores.PatternAnomalyRule = left
  }
  return scores
}

/**
 * FraudAlertResponse -> UI alert
 * { id, txnId, accountId, customer, accountNumber, amount, currency, riskScore, riskLevel,
 *   triggeredRules, ruleScores, clientCountry, transactionType, reason,
 *   status ('Open'|'Approved'|'Rejected'), reviewedBy, reviewNotes, createdAt, reviewedAt }
 */
export function mapAlert(dto, accountLookup) {
  const account = accountLookup?.get(dto.accountId)
  const rules = Array.isArray(dto.triggeredRules) ? dto.triggeredRules : []
  const amount = toNumber(dto.amount) || 0
  const riskScore = toNumber(dto.riskScore) || 0
  return {
    id: dto.id,
    txnId: dto.transactionId,
    accountId: dto.accountId,
    customer: account?.customer || `Account ${shortId(dto.accountId)}`,
    accountNumber: account?.number || shortId(dto.accountId),
    amount,
    currency: currencyOf(dto),
    riskScore,
    riskLevel: dto.riskLevel,
    triggeredRules: rules,
    ruleScores: dto.ruleScores || deriveRuleScores(rules, amount, riskScore),
    clientCountry: dto.clientCountry || null,
    transactionType: dto.transactionType || null,
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
  if (USE_MOCK) {
    const all = await mock.listFraudAlerts()
    return all.map((a) => ({ ...a, ruleScores: a.ruleScores || deriveRuleScores(a.triggeredRules, a.amount, a.riskScore) }))
  }
  const lookup = new Map((accounts || []).map((a) => [a.id, a]))
  const page = await api.get(`${BASE}/alerts`, { query: { page: 0, size: 100, status } })
  return pageContent(page).map((a) => mapAlert(a, lookup))
}

/** decision: 'APPROVE' (release the transaction) | 'REJECT' (block it) */
export async function reviewAlert(id, decision, notes) {
  if (USE_MOCK) {
    const updated = await mock.reviewFraudAlert(id, decision, notes)
    adminMock.onAlertReviewed(updated, decision)
    return updated
  }
  return mapAlert(await api.post(`${BASE}/alerts/${id}/review`, { decision, notes: notes || undefined }))
}

/** GET /fraud/stats -> { totalAlerts, alertsByStatus, totalDecisions, decisionsByRiskLevel } */
export async function getFraudStats() {
  if (USE_MOCK) return adminMock.fraudStats()
  return api.get(`${BASE}/stats`)
}
