// Turns a transaction's status + status history (GET /transactions/{id}/status) into the
// four saga steps the backend runs, with the Kafka events behind each step (README §9-10):
//   1 transaction-service  TRANSACTION_INITIATED                       PENDING
//   2 fraud-service        FRAUD_CLEARED | FRAUD_DETECTED              -> PROCESSING | UNDER_REVIEW | FAILED
//   3 account-service      BALANCE_UPDATE_REQUESTED -> BALANCE_UPDATED | BALANCE_UPDATE_FAILED
//   4 transaction-service  TRANSACTION_COMPLETED | TRANSACTION_FAILED  COMPLETED | FAILED

export const TOPIC = {
  TRANSACTION_INITIATED: 'banking.transaction.events',
  BALANCE_UPDATE_REQUESTED: 'banking.transaction.events',
  TRANSACTION_COMPLETED: 'banking.transaction.events',
  TRANSACTION_FAILED: 'banking.transaction.events',
  FRAUD_CLEARED: 'banking.fraud.events',
  FRAUD_DETECTED: 'banking.fraud.events',
  BALANCE_UPDATED: 'banking.account.events',
  BALANCE_UPDATE_FAILED: 'banking.account.events',
}

const producerOf = (name) => (TOPIC[name] === 'banking.fraud.events' ? 'fraud-service' : TOPIC[name] === 'banking.account.events' ? 'account-service' : 'transaction-service')
const ev = (name, state) => ({ name, topic: TOPIC[name], producer: producerOf(name), state })

/**
 * @param {{ status: string, history?: Array<{fromStatus,toStatus,reason,changedAt}>, failureReason?: string, kind?: 'transfer'|'deposit'|'payment' }} s
 * @returns {Array<{ key, title, service, state: 'done'|'current'|'pending'|'failed'|'warning', time?, description?, events }>}
 */
export function sagaSteps({ status, history = [], failureReason, kind = 'transfer' }) {
  const find = (to) => history.find((h) => h.toStatus === to)
  const pending = find('PENDING')
  const processing = find('PROCESSING')
  const review = find('UNDER_REVIEW')
  const failed = find('FAILED')
  const completed = find('COMPLETED')
  const isFailed = status === 'FAILED'
  const blockedByFraud = isFailed && !processing
  const reason = failureReason || failed?.reason

  const requested = {
    key: 'requested',
    title: { deposit: 'Deposit requested', payment: 'Payment requested', credit: 'Credit received' }[kind] || 'Transfer requested',
    service: 'transaction-service',
    state: 'done',
    time: pending?.changedAt,
    description: 'Validated, saved and published through the outbox. HTTP 202 returned.',
    events: [ev('TRANSACTION_INITIATED', 'done')],
  }

  let fraud
  if (processing || completed) {
    fraud = { state: 'done', time: processing?.changedAt, description: review ? 'Approved by a fraud analyst after manual review.' : 'All 4 rules passed (amount, velocity, location, pattern).', events: [...(review ? [ev('FRAUD_DETECTED', 'done')] : []), ev('FRAUD_CLEARED', 'done')] }
  } else if (status === 'UNDER_REVIEW') {
    fraud = { state: 'warning', time: review?.changedAt, description: review?.reason || 'Flagged for manual review by a fraud analyst.', events: [ev('FRAUD_DETECTED', 'done'), ev('FRAUD_CLEARED', 'pending')] }
  } else if (blockedByFraud) {
    fraud = { state: 'failed', time: failed?.changedAt, description: reason || 'Blocked by fraud rules.', events: [ev('FRAUD_DETECTED', 'failed')] }
  } else {
    fraud = { state: 'current', description: 'Scoring the transaction against the fraud rules…', events: [ev('FRAUD_CLEARED', 'pending')] }
  }

  let balance
  if (completed) {
    balance = { state: 'done', time: completed.changedAt, description: 'Debit and credit applied atomically (row locks, one DB transaction).', events: [ev('BALANCE_UPDATE_REQUESTED', 'done'), ev('BALANCE_UPDATED', 'done')] }
  } else if (isFailed && processing) {
    balance = { state: 'failed', time: failed?.changedAt, description: reason || 'Balance update rejected.', events: [ev('BALANCE_UPDATE_REQUESTED', 'done'), ev('BALANCE_UPDATE_FAILED', 'failed')] }
  } else if (status === 'PROCESSING') {
    balance = { state: 'current', time: processing?.changedAt, description: 'Locking both balances and checking available funds…', events: [ev('BALANCE_UPDATE_REQUESTED', 'done'), ev('BALANCE_UPDATED', 'pending')] }
  } else {
    balance = { state: 'pending', description: status === 'UNDER_REVIEW' ? 'Runs once the review is approved.' : blockedByFraud ? 'Skipped: nothing was debited.' : 'Waiting for the fraud decision.', events: [ev('BALANCE_UPDATE_REQUESTED', 'pending'), ev('BALANCE_UPDATED', 'pending')] }
  }

  let done
  if (completed) done = { title: 'Completed', state: 'done', time: completed.changedAt, description: 'Notification sent and every event recorded by audit-service.', events: [ev('TRANSACTION_COMPLETED', 'done')] }
  else if (isFailed) done = { title: 'Failed', state: 'failed', time: failed?.changedAt, description: 'No money moved. The transaction is closed as FAILED.', events: [ev('TRANSACTION_FAILED', 'failed')] }
  else done = { title: 'Completed', state: 'pending', description: status === 'UNDER_REVIEW' ? 'Waiting for an admin decision.' : undefined, events: [ev('TRANSACTION_COMPLETED', 'pending')] }

  return [
    requested,
    { key: 'fraud', title: 'Fraud check', service: 'fraud-service', ...fraud },
    { key: 'balance', title: 'Balance update', service: 'account-service', ...balance },
    { key: 'done', service: 'transaction-service', ...done },
  ]
}

/**
 * A plausible history for rows that have none (seed/mock rows, or when the
 * status endpoint is unavailable), so the detail timeline still renders.
 */
export function syntheticHistory(txn, statusKey) {
  const t0 = new Date(txn.date).getTime()
  const at = (ms) => new Date(t0 + ms).toISOString()
  const h = [{ fromStatus: null, toStatus: 'PENDING', reason: 'Requested', changedAt: at(0) }]
  if (statusKey === 'UNDER_REVIEW') h.push({ fromStatus: 'PENDING', toStatus: 'UNDER_REVIEW', reason: 'Flagged by fraud checks', changedAt: at(1100) })
  if (['PROCESSING', 'COMPLETED'].includes(statusKey) || (statusKey === 'FAILED' && !/fraud/i.test(txn.failureReason || ''))) {
    h.push({ fromStatus: 'PENDING', toStatus: 'PROCESSING', reason: 'Fraud check passed', changedAt: at(1100) })
  }
  if (statusKey === 'COMPLETED') h.push({ fromStatus: 'PROCESSING', toStatus: 'COMPLETED', reason: 'Balances updated', changedAt: txn.completedAt || at(2300) })
  if (statusKey === 'FAILED') h.push({ fromStatus: h[h.length - 1].toStatus, toStatus: 'FAILED', reason: txn.failureReason, changedAt: at(2300) })
  return h
}

/** Flat, time-ordered event log for the "Kafka events" side panel. */
export function sagaEventLog(steps) {
  return steps.flatMap((s) => s.events.filter((e) => e.state !== 'pending').map((e) => ({ ...e, time: s.time, step: s.title })))
}
