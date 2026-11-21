// "Add money": POST /api/v1/transactions/deposit, then follows the saga until it settles.
import { useEffect, useRef, useState } from 'react'
import { PlusCircle } from 'lucide-react'
import { Modal, ErrorBanner, Spinner } from '../ui/Primitives.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { deposit, pollTransactionStatus } from '../../services/transactionService.js'
import { newIdempotencyKey } from '../../lib/api.js'
import { USE_MOCK } from '../../lib/config.js'
import { formatCurrency, currencySymbol } from '../../lib/format.js'
import { canTransact } from '../../lib/accountTypes.js'
import SagaTracker from './SagaTracker.jsx'
import { sagaSteps } from './saga.js'

export default function AddMoneyModal({ open, accounts = [], onClose, onDone }) {
  const { showToast, refreshNotifications } = useApp()
  const eligible = accounts.filter(canTransact)
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [track, setTrack] = useState(null)
  const alive = useRef(true)
  const keyRef = useRef(null)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (open) {
      setAccountId(eligible[0]?.id || '')
      setAmount('')
      setNote('')
      setError(null)
      setTrack(null)
      keyRef.current = newIdempotencyKey()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const acc = eligible.find((a) => a.id === accountId)
  const value = parseFloat(amount) || 0
  const finished = track?.done

  async function submit(e) {
    e.preventDefault()
    if (!acc || value <= 0 || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const txn = await deposit({ accountId: acc.id, amount: value, currency: acc.currency, description: note || undefined, idempotencyKey: keyRef.current })
      setTrack({ status: txn.status || 'PENDING', history: [] })
      const final = await pollTransactionStatus(txn.id, {
        intervalMs: USE_MOCK ? 700 : 1500,
        isCancelled: () => !alive.current,
        onUpdate: (s) => alive.current && setTrack((t) => ({ ...t, ...s })),
      })
      if (!alive.current) return
      setTrack((t) => ({ ...t, ...final, done: true }))
      if (final?.status === 'COMPLETED') showToast({ title: 'Money added', description: `${formatCurrency(value, acc.currency)} credited to ${acc.name}.` })
      else if (final?.status === 'FAILED') showToast({ title: 'Deposit failed', description: final.failureReason || 'Please try again.', tone: 'error' })
      refreshNotifications()
      onDone?.()
    } catch (err) {
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add money"
      subtitle="Deposit into one of your accounts. Runs through the same saga as a transfer."
      footer={
        finished ? (
          <button type="button" className="btn-primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" form="add-money-form" className="btn-primary" disabled={!acc || value <= 0 || submitting || Boolean(track)}>
              {submitting ? <Spinner /> : <PlusCircle size={16} />} {track ? 'Processing…' : `Add ${value > 0 ? formatCurrency(value, acc?.currency) : 'money'}`}
            </button>
          </>
        )
      }
    >
      {track ? (
        <div className="py-1"><SagaTracker steps={sagaSteps({ ...track, kind: 'deposit' })} compact /></div>
      ) : (
        <form id="add-money-form" onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="am-acc">To account</label>
            <select id="am-acc" className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {eligible.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.number})</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="am-amt">Amount</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{currencySymbol(acc?.currency)}</span>
              <input id="am-amt" className="input pl-8 text-lg font-semibold" type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[1000, 5000, 10000, 25000].map((q) => (
                <button key={q} type="button" onClick={() => setAmount(String(q))} className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:text-slate-300 dark:hover:border-brand-400/50 dark:hover:text-brand-300">
                  {formatCurrency(q, acc?.currency).replace(/\.00$/, '')}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="am-note">Note <span className="font-normal text-slate-400">(optional)</span></label>
            <input id="am-note" className="input" maxLength={255} placeholder="e.g. Cash deposit" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <ErrorBanner error={error} />}
        </form>
      )}
    </Modal>
  )
}
