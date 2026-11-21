import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeftRight, ArrowRight, CheckCircle2, XCircle, Clock, Wallet, Plus } from 'lucide-react'
import { PageHeader, Card, AsyncView, EmptyState, ErrorBanner, Spinner, StatusBadge } from '../../components/ui/Primitives.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { listMyAccounts } from '../../services/accountService.js'
import { transfer, pollTransactionStatus } from '../../services/transactionService.js'
import { humanize } from '../../services/mappers.js'
import { formatCurrency, currencySymbol, formatTime } from '../../lib/format.js'

const OTHER = '__other__'

export default function Transfer() {
  const { user } = useAuth()
  const state = useAsync(() => listMyAccounts(user), [user?.userId])

  return (
    <>
      <PageHeader title="Move money" subtitle="Transfer between your accounts or to another Meridian account." />
      <AsyncView state={state} card loadingLabel="Loading your accounts…" errorTitle="Couldn't load your accounts">
        {(accounts) => {
          const active = accounts.filter((a) => a.status === 'Active')
          if (active.length === 0) {
            return (
              <Card>
                <EmptyState
                  icon={Wallet}
                  title="No active accounts"
                  message="You need an active account to send money."
                  action={<Link to="/accounts?open=1" className="btn-primary"><Plus size={16} /> Open an account</Link>}
                />
              </Card>
            )
          }
          return <TransferForm accounts={active} onSettled={state.reload} />
        }}
      </AsyncView>
    </>
  )
}

function TransferForm({ accounts, onSettled }) {
  const { showToast, refreshNotifications } = useApp()
  const [params] = useSearchParams()
  const initialFrom = accounts.some((a) => a.id === params.get('from')) ? params.get('from') : accounts[0].id
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(() => accounts.find((a) => a.id !== initialFrom)?.id || OTHER)
  const [otherId, setOtherId] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [tracking, setTracking] = useState(null) // { id, reference, amount, currency, status, history, failureReason, done, timedOut }

  const cancelled = useRef(false)
  useEffect(() => {
    cancelled.current = false // (re)mounted — StrictMode mounts twice in dev
    return () => { cancelled.current = true }
  }, [])

  const fromAcc = accounts.find((a) => a.id === from)
  const currency = fromAcc?.currency
  const destinationId = to === OTHER ? otherId.trim() : to
  const toAcc = accounts.find((a) => a.id === destinationId)
  const numericAmount = parseFloat(amount) || 0
  const sameAccount = destinationId && from === destinationId
  const currencyMismatch = toAcc && toAcc.currency !== currency
  const overBalance = fromAcc && fromAcc.type !== 'Credit' && numericAmount > fromAcc.available
  const busy = submitting || (tracking && !tracking.done)
  const canSubmit = numericAmount > 0 && destinationId && !sameAccount && !overBalance && !currencyMismatch && !busy
  const quickAmounts = currency === 'INR' ? [500, 1000, 5000, 10000] : [50, 100, 250, 500]

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const txn = await transfer({
        sourceAccountId: from,
        destinationAccountId: destinationId,
        amount: numericAmount,
        currency,
        description: memo,
      })
      setTracking({ id: txn.id, reference: txn.reference, amount: numericAmount, currency, status: txn.status || 'PENDING', history: [], done: false })
      setSubmitting(false)
      setAmount('')
      setMemo('')

      const final = await pollTransactionStatus(txn.id, {
        isCancelled: () => cancelled.current,
        onUpdate: (s) => !cancelled.current && setTracking((t) => ({ ...t, ...s })),
      })
      if (cancelled.current) return
      setTracking((t) => ({ ...t, ...final, done: true }))

      if (final?.status === 'COMPLETED') showToast(`Transfer of ${formatCurrency(numericAmount, currency)} completed`)
      else if (final?.status === 'FAILED') showToast(`Transfer failed: ${final.failureReason || 'unknown reason'}`, 'error')
      else if (final?.status === 'UNDER_REVIEW') showToast('Transfer is under fraud review')
      onSettledLater()
    } catch (err) {
      setSubmitting(false)
      setError(err)
      setTracking((t) => (t ? { ...t, done: true, pollError: err } : t))
    }
  }

  // Refresh balances + notifications once the saga settled (kept separate so the
  // result panel stays visible while accounts reload).
  function onSettledLater() {
    refreshNotifications()
    setTimeout(() => !cancelled.current && onSettled(), 1500)
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="p-6 lg:col-span-2">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">From</label>
              <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.number})</option>
                ))}
              </select>
              {fromAcc && <p className="mt-1.5 text-xs text-slate-500">Available: {formatCurrency(fromAcc.available, fromAcc.currency)}</p>}
            </div>
            <div>
              <label className="label">To</label>
              <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.number})</option>
                ))}
                <option value={OTHER}>Another account (enter ID)…</option>
              </select>
              {to === OTHER && (
                <input
                  className="input mt-2 font-mono text-xs"
                  placeholder="Destination account ID (UUID)"
                  value={otherId}
                  onChange={(e) => setOtherId(e.target.value)}
                />
              )}
              {sameAccount && <p className="mt-1.5 text-xs text-rose-600">Choose two different accounts.</p>}
              {currencyMismatch && <p className="mt-1.5 text-xs text-rose-600">Both accounts must use the same currency.</p>}
            </div>
          </div>

          <div>
            <label className="label">Amount ({currency})</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{currencySymbol(currency)}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input pl-8 text-lg font-semibold"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            {overBalance && <p className="mt-1.5 text-xs text-rose-600">Amount exceeds available balance.</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {quickAmounts.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setAmount(String(q))}
                  className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700"
                >
                  {formatCurrency(q, currency).replace(/\.00$/, '')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Memo (optional)</label>
            <input className="input" placeholder="e.g. Monthly savings" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={255} />
          </div>

          {error && <ErrorBanner error={error} />}

          <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
            {submitting ? <Spinner /> : <ArrowLeftRight size={16} />} {submitting ? 'Submitting…' : 'Send money'}
          </button>
        </form>
      </Card>

      <div className="space-y-6">
        {tracking && <TransferProgress tracking={tracking} onDismiss={() => setTracking(null)} />}

        {/* Summary */}
        <Card className="p-6 h-fit">
          <h3 className="font-semibold text-slate-900">Transfer summary</h3>
          <div className="mt-4 space-y-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">From</span>
              <span className="font-medium text-slate-800 text-right">{fromAcc?.name} {fromAcc?.number}</span>
            </div>
            <div className="grid place-items-center text-slate-300"><ArrowRight size={16} className="rotate-90" /></div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">To</span>
              <span className="font-medium text-slate-800 text-right break-all">
                {toAcc ? `${toAcc.name} ${toAcc.number}` : destinationId || '—'}
              </span>
            </div>
            <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
              <span className="text-slate-500">Amount</span>
              <span className="text-xl font-bold text-slate-900">{formatCurrency(numericAmount, currency)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Fee</span>
              <span className="font-medium text-emerald-600">Free</span>
            </div>
          </div>
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            Transfers run through fraud checks first, then balances are updated. Large amounts may be held for review.
          </p>
        </Card>
      </div>
    </div>
  )
}

// Live view of the transfer saga while we poll /transactions/{id}/status.
function TransferProgress({ tracking, onDismiss }) {
  const { status, done, timedOut, failureReason, history = [], reference, amount, currency, pollError } = tracking
  const tone =
    status === 'COMPLETED' ? { icon: CheckCircle2, cls: 'text-emerald-600 bg-emerald-50', title: 'Transfer completed' }
    : status === 'FAILED' ? { icon: XCircle, cls: 'text-rose-600 bg-rose-50', title: 'Transfer failed' }
    : status === 'UNDER_REVIEW' ? { icon: Clock, cls: 'text-amber-600 bg-amber-50', title: 'Held for review' }
    : { icon: null, cls: 'text-brand-600 bg-brand-50', title: 'Processing transfer…' }
  const Icon = tone.icon

  return (
    <Card className="p-6 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${tone.cls}`}>
          {Icon ? <Icon size={22} /> : <Spinner size={20} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{tone.title}</p>
          <p className="text-sm text-slate-500">{formatCurrency(amount, currency)}{reference ? ` · ${reference}` : ''}</p>
        </div>
        <StatusBadge status={humanize(status)} />
      </div>

      {status === 'FAILED' && failureReason && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{failureReason}</p>}
      {status === 'UNDER_REVIEW' && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Our fraud team needs to approve this transfer. You'll get a notification once it's decided.
        </p>
      )}
      {timedOut && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Still processing — check Transactions for the final status.</p>}
      {pollError && <p className="mt-3 text-sm text-rose-600">Lost track of the transfer: {pollError.message}</p>}

      {history.length > 0 && (
        <ol className="mt-4 space-y-2 border-l border-slate-200 pl-4">
          {history.map((h, i) => (
            <li key={i} className="text-xs">
              <span className="font-semibold text-slate-700">{humanize(h.toStatus)}</span>
              <span className="text-slate-400"> · {formatTime(h.changedAt)}</span>
              {h.reason && <p className="text-slate-500">{h.reason}</p>}
            </li>
          ))}
        </ol>
      )}

      {done && (
        <div className="mt-4 flex gap-2">
          <Link to="/transactions" className="btn-ghost flex-1">View transactions</Link>
          <button className="btn-ghost" onClick={onDismiss}>Dismiss</button>
        </div>
      )}
    </Card>
  )
}
