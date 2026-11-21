// Detail panel for one transaction: amount hero, key facts, the saga status timeline
// (from GET /transactions/{id}/status when available) and a printable receipt.
import { useEffect, useState } from 'react'
import { Download, Send, ShieldCheck, Database, CircleCheckBig } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Drawer, KeyValue, Timeline, StatusBadge, Skeleton } from '../ui/Primitives.jsx'
import { formatDate, formatTime } from '../../lib/format.js'
import { txnChannel, txnStatusKey, humanize } from '../../services/mappers.js'
import { getTransactionStatus } from '../../services/transactionService.js'
import { TxnIcon, TxnAmount, categoryMeta } from './TxnBits.jsx'
import { sagaSteps, syntheticHistory } from './saga.js'
import ReceiptView from './ReceiptView.jsx'

const STEP_ICON = { requested: Send, fraud: ShieldCheck, balance: Database, done: CircleCheckBig }

export function accountLabelOf(acc) {
  return acc ? `${acc.name} · ${acc.number}` : null
}

/** Own account(s) a transaction touches, and the other side (if it isn't one of ours). */
export function describeParties(txn, accountById) {
  const own = (txn.accountIds || []).map((id) => accountById.get(id)).filter(Boolean)
  const src = accountById.get(txn.sourceAccountId)
  const dst = accountById.get(txn.destinationAccountId)
  let account = accountLabelOf(own[0])
  let counterparty = txn.description
  if (txn.type === 'internal' && src && dst) {
    account = accountLabelOf(src)
    counterparty = accountLabelOf(dst)
  } else if (txn.destinationAccountId && !dst && txn.type === 'debit' && !txn.channel) {
    counterparty = `Account ${String(txn.destinationAccountId).slice(0, 8)}…`
  }
  return { account: account || '—', counterparty }
}

export default function TransactionDrawer({ txn, accountById, onClose }) {
  const [history, setHistory] = useState(null) // null = loading, [] = none
  const [receipt, setReceipt] = useState(false)
  const statusKey = txnStatusKey(txn)

  useEffect(() => {
    if (!txn) return undefined
    let active = true
    setHistory(null)
    getTransactionStatus(txn.id)
      .then((s) => active && setHistory(Array.isArray(s?.history) && s.history.length ? s.history : []))
      .catch(() => active && setHistory([]))
    return () => { active = false }
  }, [txn?.id])

  if (!txn) return null
  const { account, counterparty } = describeParties(txn, accountById)
  const realHistory = history && history.length > 0
  const steps = sagaSteps({
    status: statusKey,
    history: realHistory ? history : syntheticHistory(txn, statusKey),
    failureReason: txn.failureReason,
    kind: txn.transactionType === 'DEPOSIT' || txn.category === 'Deposit' ? 'deposit' : txn.type === 'credit' ? 'credit' : txn.transactionType === 'TRANSFER' || txn.type === 'internal' || /transfer/i.test(txn.category) ? 'transfer' : 'payment',
  })
  const CatIcon = categoryMeta(txn.category).icon

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title="Transaction details"
        subtitle={`${formatDate(txn.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${formatTime(txn.date)}`}
        footer={
          <>
            {txn.type !== 'credit' && <Link to="/transfer" className="btn-ghost"><Send size={15} /> Send again</Link>}
            <button type="button" className="btn-primary" onClick={() => setReceipt(true)}><Download size={15} /> Download receipt</button>
          </>
        }
      >
        {/* Amount hero */}
        <div className="rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50 to-white p-5 text-center dark:border-white/[0.06] dark:from-white/[0.04] dark:to-transparent">
          <div className="flex justify-center"><TxnIcon txn={txn} size={52} /></div>
          <p className="heading mt-3 font-semibold">{txn.description}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight"><TxnAmount txn={txn} /></p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <StatusBadge status={statusKey === 'COMPLETED' ? 'Completed' : humanize(statusKey)} />
            <span className="inline-flex items-center rounded-md border border-slate-200 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-white/10 dark:text-slate-400">{txnChannel(txn)}</span>
          </div>
          {txn.failureReason && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{txn.failureReason}</p>}
        </div>

        <div className="mt-5">
          <KeyValue
            items={[
              { label: txn.type === 'credit' ? 'From' : 'To', value: counterparty },
              { label: 'Category', value: <span className="inline-flex items-center gap-1.5"><CatIcon size={14} className="text-slate-400" />{txn.category}</span> },
              { label: 'Channel', value: txnChannel(txn) },
              { label: 'Account', value: account },
              { label: 'Reference', value: txn.reference, mono: true, copy: txn.reference },
              { label: 'Date & time', value: `${formatDate(txn.date)}, ${formatTime(txn.date)}` },
              txn.riskScore !== null && txn.riskScore !== undefined && { label: 'Fraud risk score', value: `${txn.riskScore} / 100` },
              { label: 'Transaction ID', value: txn.id, mono: true, copy: txn.id },
            ]}
          />
        </div>

        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="heading text-[15px] font-semibold">Status timeline</h3>
            <span className="muted text-[11px]">{history === null ? 'Loading…' : realHistory ? 'From the status API' : 'Settled'}</span>
          </div>
          {history === null ? (
            <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <Timeline
              items={steps.map((s) => ({
                title: `${s.title}`,
                description: `${s.service} · ${s.events.filter((e) => e.state !== 'pending').map((e) => e.name).join(', ') || 'waiting'}`,
                time: s.time ? `${formatDate(s.time, { day: 'numeric', month: 'short' })}, ${new Date(s.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : undefined,
                state: s.state,
                icon: STEP_ICON[s.key],
              }))}
            />
          )}
        </div>
      </Drawer>
      {receipt && <ReceiptView txn={txn} accountLabel={account} counterparty={counterparty} onClose={() => setReceipt(false)} />}
    </>
  )
}
