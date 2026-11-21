import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight, ArrowLeft, Wallet, Plus, Send, ShieldAlert, Zap, BadgeIndianRupee, CheckCircle2, XCircle, Clock,
  UserPlus, Star, Search, Check, Radio, Download, RotateCcw, Hourglass, Info, Fingerprint, Trash2,
} from 'lucide-react'
import { PageHeader, Card, CardHeader, EmptyState, ErrorState, ErrorBanner, Spinner, Avatar, Segmented, CopyButton, Skeleton } from '../../components/ui/Primitives.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { USE_MOCK } from '../../lib/config.js'
import { newIdempotencyKey } from '../../lib/api.js'
import { listMyAccounts, lookupAccount } from '../../services/accountService.js'
import { transfer, pollTransactionStatus } from '../../services/transactionService.js'
import { formatCurrency, currencySymbol } from '../../lib/format.js'
import { accountTypeIcon, accountTypeTone, canTransact } from '../../lib/accountTypes.js'
import SagaTracker, { timeWithSeconds } from '../../components/customer/SagaTracker.jsx'
import ReceiptView from '../../components/customer/ReceiptView.jsx'
import { sagaSteps, sagaEventLog } from '../../components/customer/saga.js'

const REVIEW_THRESHOLD = 100000 // fraud-service: large amounts go to manual review
const STEPS = ['Details', 'Review', 'Processing', 'Done']

/* ------------------------------------------------------------------ saved payees (local) */

const DEMO_PAYEES = [
  { id: 'acc_sav_31', name: 'Priya Patel', number: '**** 3310', note: 'Savings' },
  { id: 'acc_sav_88', name: 'Vikram Rao', number: '**** 9921', note: 'Savings' },
  { id: 'acc_sav_22', name: 'Kavya Nair', number: '**** 2204', note: 'Savings' },
]
const payeeKey = (user) => `meridian.payees.${user?.userId || 'anon'}`

function loadPayees(user) {
  try {
    const raw = localStorage.getItem(payeeKey(user))
    if (raw) return JSON.parse(raw)
  } catch { /* storage blocked */ }
  return USE_MOCK ? DEMO_PAYEES.filter((p) => p.name !== user?.name) : []
}
function savePayees(user, list) {
  try { localStorage.setItem(payeeKey(user), JSON.stringify(list)) } catch { /* storage blocked */ }
}

/* ------------------------------------------------------------------ page */

export default function Transfer() {
  const { user } = useAuth()
  const state = useAsync(() => listMyAccounts(user), [user?.userId])

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Payments" title="Send money" subtitle="Instant transfers between Meridian accounts, checked by our fraud engine in real time." />
      {state.error ? (
        <Card><ErrorState error={state.error} onRetry={state.reload} title="Couldn't load your accounts" /></Card>
      ) : state.data === undefined ? (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3" role="status" aria-label="Loading">
          <Skeleton className="h-[560px] rounded-2xl lg:col-span-2" />
          <Skeleton className="h-[360px] rounded-2xl" />
        </div>
      ) : state.data.filter(canTransact).length === 0 ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="No account to send from"
            message="You need an active savings or current account to send money."
            action={<Link to="/accounts?open=1" className="btn-primary"><Plus size={16} /> Open an account</Link>}
          />
        </Card>
      ) : (
        <TransferFlow accounts={state.data} user={user} onSettled={state.reload} />
      )}
    </div>
  )
}

function Stepper({ index, failed }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {STEPS.map((label, i) => {
        const done = i < index
        const current = i === index
        const bad = failed && i === index
        return (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors ${bad ? 'bg-rose-500 text-white' : done ? 'bg-emerald-500 text-white' : current ? 'bg-brand-600 text-white ring-4 ring-brand-500/15' : 'bg-slate-100 text-slate-400 dark:bg-white/[0.06] dark:text-slate-500'}`} aria-current={current ? 'step' : undefined}>
              {done ? <Check size={14} /> : i + 1}
            </span>
            <span className={`hidden text-sm font-medium sm:inline ${current ? 'heading' : 'muted'}`}>{label}</span>
            {i < STEPS.length - 1 && <span className={`h-0.5 flex-1 rounded-full ${done ? 'bg-emerald-400/70' : 'bg-slate-200 dark:bg-white/10'}`} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

function TransferFlow({ accounts, user, onSettled }) {
  const { showToast, refreshNotifications } = useApp()
  const [params] = useSearchParams()
  const sources = accounts.filter(canTransact)
  const initialFrom = sources.some((a) => a.id === params.get('from')) ? params.get('from') : sources[0].id

  const [step, setStep] = useState('details') // details | review | tracking
  const [from, setFrom] = useState(initialFrom)
  const [mode, setMode] = useState('own') // own | payee | other
  const [ownTo, setOwnTo] = useState(() => accounts.find((a) => a.id !== initialFrom && a.status === 'Active')?.id || '')
  const [payees, setPayees] = useState(() => loadPayees(user))
  const [payeeId, setPayeeId] = useState(null)
  const [otherId, setOtherId] = useState('')
  const [savePayee, setSavePayee] = useState(false)
  const [payeeName, setPayeeName] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [tracking, setTracking] = useState(null)
  const [receipt, setReceipt] = useState(false)
  const idemKey = useRef(null)

  const cancelled = useRef(false)
  useEffect(() => {
    cancelled.current = false // (re)mounted: StrictMode mounts twice in dev
    return () => { cancelled.current = true }
  }, [])

  // live lookup for a typed account id
  const [lookup, setLookup] = useState({ state: 'idle' })
  useEffect(() => {
    const id = otherId.trim()
    if (mode !== 'other' || id.length < 3) { setLookup({ state: 'idle' }); return undefined }
    let active = true
    setLookup({ state: 'loading' })
    const t = setTimeout(() => {
      lookupAccount(id)
        .then((r) => active && setLookup(r ? { state: 'found', account: r } : { state: 'unknown' }))
        .catch(() => active && setLookup({ state: 'unknown' }))
    }, 350)
    return () => { active = false; clearTimeout(t) }
  }, [otherId, mode])

  const fromAcc = accounts.find((a) => a.id === from)
  const currency = fromAcc?.currency
  const payee = payees.find((p) => p.id === payeeId)
  const destinationId = mode === 'own' ? ownTo : mode === 'payee' ? payee?.id || '' : otherId.trim()
  const ownDest = accounts.find((a) => a.id === destinationId)
  const recipient = ownDest
    ? { name: ownDest.name, detail: `${ownDest.type} · ${ownDest.number}`, own: true }
    : mode === 'payee' && payee
      ? { name: payee.name, detail: `Meridian · ${payee.number}` }
      : lookup.state === 'found'
        ? { name: lookup.account.name, detail: `${lookup.account.type} · ${lookup.account.number}` }
        : destinationId ? { name: payeeName || 'Meridian account', detail: destinationId } : null

  const value = parseFloat(amount) || 0
  const sameAccount = destinationId && from === destinationId
  const currencyMismatch = ownDest && ownDest.currency !== currency
  const overBalance = fromAcc && value > fromAcc.available
  const needsReview = value > REVIEW_THRESHOLD
  const canContinue = value > 0 && destinationId && !sameAccount && !overBalance && !currencyMismatch
  const quick = currency === 'INR' ? [500, 1000, 5000, 10000] : [50, 100, 250, 500]
  const money = (v) => formatCurrency(v, currency)

  function goReview() {
    if (!canContinue) return
    idemKey.current = newIdempotencyKey() // one key per reviewed transfer: retries reuse it
    setError(null)
    setStep('review')
  }

  async function confirm() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      if (mode === 'other' && savePayee && !payees.some((p) => p.id === destinationId)) {
        const name = payeeName.trim() || (lookup.state === 'found' ? lookup.account.name : `Account ${destinationId.slice(0, 6)}`)
        const next = [...payees, { id: destinationId, name, number: lookup.account?.number || `…${destinationId.slice(-4)}` }]
        setPayees(next)
        savePayees(user, next)
      }
      const txn = await transfer({ sourceAccountId: from, destinationAccountId: destinationId, amount: value, currency, description: note, idempotencyKey: idemKey.current })
      const startedAt = new Date().toISOString()
      setTracking({ id: txn.id, reference: txn.reference, amount: value, currency, status: txn.status || 'PENDING', history: [], done: false, startedAt, recipient, own: Boolean(ownDest), note })
      setStep('tracking')
      setSubmitting(false)

      const final = await pollTransactionStatus(txn.id, {
        intervalMs: USE_MOCK ? 700 : 1500,
        isCancelled: () => cancelled.current,
        onUpdate: (s) => !cancelled.current && setTracking((t) => ({ ...t, ...s })),
      })
      if (cancelled.current) return
      setTracking((t) => ({ ...t, ...final, done: true }))

      if (final?.status === 'COMPLETED') showToast({ title: 'Transfer completed', description: `${money(value)} sent to ${recipient?.name}.` })
      else if (final?.status === 'FAILED') showToast({ title: 'Transfer failed', description: final.failureReason || 'No money was moved.', tone: 'error' })
      else if (final?.status === 'UNDER_REVIEW') showToast({ title: 'Held for review', description: 'A fraud analyst will check this transfer.', tone: 'info' })
      refreshNotifications()
      setTimeout(() => !cancelled.current && onSettled(), 1500)
    } catch (err) {
      setSubmitting(false)
      setError(err)
      setTracking((t) => (t ? { ...t, done: true, pollError: err } : t))
    }
  }

  function sendAnother() {
    setTracking(null)
    setAmount('')
    setNote('')
    setError(null)
    setStep('details')
  }

  function removePayee(id) {
    const next = payees.filter((p) => p.id !== id)
    setPayees(next)
    savePayees(user, next)
    if (payeeId === id) setPayeeId(null)
  }

  const stepIndex = step === 'details' ? 0 : step === 'review' ? 1 : !tracking?.done || tracking.status === 'UNDER_REVIEW' ? 2 : tracking.status === 'COMPLETED' ? 4 : 3
  const failed = tracking?.done && tracking.status === 'FAILED'

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
      <Card className="overflow-hidden lg:col-span-2">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-white/[0.06] sm:px-6">
          <Stepper index={stepIndex} failed={failed} />
        </div>

        {step === 'details' && (
          <form className="space-y-7 p-5 sm:p-6" onSubmit={(e) => { e.preventDefault(); goReview() }}>
            {/* From */}
            <fieldset>
              <legend className="label">From</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {sources.map((a) => (
                  <AccountOption key={a.id} acc={a} active={a.id === from} onClick={() => { setFrom(a.id); if (ownTo === a.id) setOwnTo(accounts.find((x) => x.id !== a.id && x.status === 'Active')?.id || '') }} sub={`Available ${formatCurrency(a.available, a.currency)}`} />
                ))}
              </div>
            </fieldset>

            {/* To */}
            <fieldset>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <legend className="label mb-0">To</legend>
                <Segmented
                  size="sm"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'own', label: 'My accounts' },
                    { value: 'payee', label: 'Saved payees', count: payees.length },
                    { value: 'other', label: 'Account ID' },
                  ]}
                />
              </div>

              {mode === 'own' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {accounts.filter((a) => a.id !== from && a.status === 'Active').map((a) => (
                    <AccountOption key={a.id} acc={a} active={a.id === ownTo} onClick={() => setOwnTo(a.id)} sub={`${a.type} · ${a.number}`} />
                  ))}
                  {accounts.filter((a) => a.id !== from && a.status === 'Active').length === 0 && (
                    <p className="muted rounded-xl border border-dashed border-slate-200 p-4 text-sm dark:border-white/10 sm:col-span-2">You have no other active account. <Link to="/accounts?open=1" className="font-semibold text-brand-600 dark:text-brand-400">Open one</Link> or pick a payee.</p>
                  )}
                </div>
              )}

              {mode === 'payee' && (
                payees.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center dark:border-white/10">
                    <UserPlus size={22} className="mx-auto text-slate-400" />
                    <p className="heading mt-2 text-sm font-medium">No saved payees yet</p>
                    <p className="muted mt-0.5 text-xs">Send to an account ID once and tick "Save as payee".</p>
                    <button type="button" className="btn-ghost mt-3" onClick={() => setMode('other')}>Enter an account ID</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {payees.map((p) => {
                      const active = p.id === payeeId
                      return (
                        <div key={p.id} className={`group flex items-center gap-2 rounded-full border py-1 pl-1 pr-1.5 transition-all ${active ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20 dark:border-brand-400 dark:bg-brand-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'}`}>
                          <button type="button" onClick={() => setPayeeId(p.id)} className="flex items-center gap-2 text-left" aria-pressed={active}>
                            <Avatar name={p.name} size={30} />
                            <span className="pr-1">
                              <span className="heading block text-sm font-medium leading-tight">{p.name}</span>
                              <span className="muted block font-mono text-[10px] leading-tight">{p.number}</span>
                            </span>
                          </button>
                          {active ? <Check size={15} className="text-brand-600 dark:text-brand-300" /> : (
                            <button type="button" onClick={() => removePayee(p.id)} className="rounded-full p-1 text-slate-300 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100 focus:opacity-100 dark:text-slate-600" aria-label={`Remove ${p.name}`}><Trash2 size={13} /></button>
                          )}
                        </div>
                      )
                    })}
                    <button type="button" onClick={() => setMode('other')} className="flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-white/15 dark:text-slate-400 dark:hover:text-brand-300"><UserPlus size={15} /> New payee</button>
                  </div>
                )
              )}

              {mode === 'other' && (
                <div className="space-y-3">
                  <div className="relative">
                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="input pl-9 font-mono text-sm" placeholder="Recipient account ID (UUID)" value={otherId} onChange={(e) => setOtherId(e.target.value)} aria-label="Recipient account ID" spellCheck={false} />
                  </div>
                  {lookup.state === 'loading' && <p className="muted inline-flex items-center gap-2 text-xs"><Spinner size={13} /> Looking up account…</p>}
                  {lookup.state === 'found' && (
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                      <Avatar name={lookup.account.name} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="heading text-sm font-semibold">{lookup.account.name}</p>
                        <p className="muted text-xs">{lookup.account.type} · {lookup.account.number}</p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={14} /> Verified</span>
                    </div>
                  )}
                  {lookup.state === 'unknown' && (
                    <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
                      <Info size={14} className="mt-0.5 shrink-0" /> We couldn't preview this account. account-service will validate it during the transfer; an unknown ID fails safely with no money moved.
                    </p>
                  )}
                  {otherId.trim() && (
                    <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={savePayee} onChange={(e) => setSavePayee(e.target.checked)} />
                      Save as payee
                      {savePayee && <input className="input ml-1 h-8 w-48 py-1 text-xs" placeholder="Nickname" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} aria-label="Payee nickname" />}
                    </label>
                  )}
                </div>
              )}
              {sameAccount && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">Choose two different accounts.</p>}
              {currencyMismatch && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">Both accounts must use the same currency.</p>}
            </fieldset>

            {/* Amount */}
            <div>
              <label className="label" htmlFor="tf-amount">Amount</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-slate-400">{currencySymbol(currency)}</span>
                <input id="tf-amount" type="number" min="0" step="0.01" inputMode="decimal" className="input h-16 pl-11 text-3xl font-bold tracking-tight" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {quick.map((q) => (
                  <button key={q} type="button" onClick={() => setAmount(String(q))} className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${value === q ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-300' : 'border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:text-slate-300 dark:hover:border-brand-400/50 dark:hover:text-brand-300'}`}>
                    {formatCurrency(q, currency).replace(/\.00$/, '')}
                  </button>
                ))}
                {fromAcc && <span className="muted ml-auto text-xs">Available <span className="tabular font-medium text-slate-700 dark:text-slate-200">{money(fromAcc.available)}</span></span>}
              </div>
              {overBalance && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">That's more than the available balance of {fromAcc.name}.</p>}
              {!overBalance && needsReview && (
                <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                  <ShieldAlert size={15} className="mt-0.5 shrink-0" /> Transfers above {formatCurrency(REVIEW_THRESHOLD, currency).replace(/\.00$/, '')} are flagged by fraud-service and held until an analyst approves them.
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="tf-note">Note <span className="font-normal text-slate-400">(optional)</span></label>
              <input id="tf-note" className="input" placeholder="e.g. Dinner split, rent for December" value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-5 dark:border-white/[0.06]">
              <p className="muted hidden text-xs sm:block">You'll review everything before money moves.</p>
              <button type="submit" className="btn-primary w-full sm:w-auto" disabled={!canContinue}>Review transfer <ArrowRight size={16} /></button>
            </div>
          </form>
        )}

        {step === 'review' && (
          <div className="p-5 sm:p-6">
            <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-white p-5 text-center ring-1 ring-slate-100 dark:from-white/[0.04] dark:to-transparent dark:ring-white/[0.06]">
              <p className="muted text-xs font-medium uppercase tracking-wider">You're sending</p>
              <p className="heading tabular mt-1 text-4xl font-bold tracking-tight">{money(value)}</p>
              <div className="mt-5 flex items-center justify-center gap-3 sm:gap-6">
                <Party name={fromAcc.name} detail={fromAcc.number} icon={accountTypeIcon[fromAcc.type]} />
                <div className="flex flex-col items-center text-slate-300 dark:text-slate-600">
                  <ArrowRight size={22} />
                </div>
                <Party name={recipient?.name} detail={recipient?.own ? ownDest.number : recipient?.detail} person={!recipient?.own} />
              </div>
            </div>

            <dl className="mt-5 divide-y divide-slate-100 text-sm dark:divide-white/[0.06]">
              <Row label="Transfer fee" value={<span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(0, currency)} · Free</span>} />
              <Row label="Arrives" value={<span className="inline-flex items-center gap-1.5"><Zap size={14} className="text-amber-500" /> Instantly, if cleared</span>} />
              <Row label="From" value={`${fromAcc.name} · ${fromAcc.number}`} />
              <Row label="Balance after" value={<span className="tabular">{money(fromAcc.available - value)}</span>} />
              {note && <Row label="Note" value={note} />}
              <Row label="Idempotency-Key" value={<span className="inline-flex items-center gap-1 font-mono text-[11px]">{idemKey.current?.slice(0, 18)}…<CopyButton value={idemKey.current} label="Copy idempotency key" /></span>} />
            </dl>

            {needsReview ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                <ShieldAlert size={15} className="mt-0.5 shrink-0" /> This amount is above {formatCurrency(REVIEW_THRESHOLD, currency).replace(/\.00$/, '')}. Expect fraud-service to flag it for manual review: nothing is debited until an admin approves it.
              </p>
            ) : (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
                <Fingerprint size={15} className="mt-0.5 shrink-0 text-brand-500" /> Every transfer is scored by 4 fraud rules before any balance changes. The Idempotency-Key makes a retried request safe: it can never be applied twice.
              </p>
            )}

            {error && <div className="mt-4"><ErrorBanner error={error} /></div>}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <button type="button" className="btn-ghost" onClick={() => setStep('details')} disabled={submitting}><ArrowLeft size={16} /> Edit details</button>
              <button type="button" className="btn-primary" onClick={confirm} disabled={submitting}>
                {submitting ? <Spinner /> : <Send size={16} />} {submitting ? 'Sending…' : `Confirm and send ${money(value)}`}
              </button>
            </div>
          </div>
        )}

        {step === 'tracking' && tracking && (
          <TrackingPanel
            tracking={tracking}
            currency={currency}
            onAnother={sendAnother}
            onRetry={() => { setTracking(null); setStep('details') }}
            onReceipt={() => setReceipt(true)}
          />
        )}
      </Card>

      <div className="space-y-4 sm:space-y-6">
        {step === 'tracking' && tracking ? <EventLog tracking={tracking} /> : <HowItWorks />}
        {step !== 'tracking' && <Limits currency={currency} />}
      </div>

      {receipt && tracking && (
        <ReceiptView
          txn={{
            id: tracking.id,
            reference: tracking.reference,
            date: tracking.startedAt,
            amount: -tracking.amount,
            currency: tracking.currency,
            type: tracking.own ? 'internal' : 'debit',
            category: 'Transfer',
            channel: tracking.own ? 'Internal' : 'IMPS',
            description: tracking.note || `Transfer to ${tracking.recipient?.name}`,
            rawStatus: tracking.status,
            failureReason: tracking.failureReason,
          }}
          accountLabel={`${fromAcc.name} · ${fromAcc.number}`}
          counterparty={`${tracking.recipient?.name}${tracking.recipient?.detail ? ` (${tracking.recipient.detail})` : ''}`}
          onClose={() => setReceipt(false)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */

function AccountOption({ acc, active, onClick, sub }) {
  const Icon = accountTypeIcon[acc.type] || Wallet
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${active ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20 dark:border-brand-400 dark:bg-brand-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'}`}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${accountTypeTone[acc.type] || accountTypeTone.Current}`}><Icon size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="heading block truncate text-sm font-semibold">{acc.name}</span>
        <span className="muted tabular block truncate text-xs">{sub}</span>
      </span>
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${active ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-400 dark:bg-brand-400' : 'border-slate-300 dark:border-white/20'}`} aria-hidden>
        {active && <Check size={11} strokeWidth={3} />}
      </span>
    </button>
  )
}

function Party({ name, detail, icon: Icon, person }) {
  return (
    <div className="flex w-32 flex-col items-center text-center sm:w-40">
      {person ? <Avatar name={name} size={48} /> : (
        <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">{Icon ? <Icon size={22} /> : <Wallet size={22} />}</span>
      )}
      <p className="heading mt-2 w-full truncate text-sm font-semibold">{name || '—'}</p>
      <p className="muted w-full truncate font-mono text-[11px]">{detail}</p>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="muted shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  )
}

function TrackingPanel({ tracking, currency, onAnother, onRetry, onReceipt }) {
  const { status, done, timedOut, failureReason, reference, amount, recipient, pollError } = tracking
  const steps = sagaSteps({ status, history: tracking.history, failureReason })
  const money = formatCurrency(amount, currency)

  const head =
    status === 'COMPLETED' && done ? { icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300', title: `${money} sent`, text: `Delivered to ${recipient?.name}. Balances were updated atomically.` }
    : status === 'FAILED' ? { icon: XCircle, tone: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300', title: 'Transfer failed', text: `${failureReason || 'The transfer could not be completed'}. No money left your account.` }
    : status === 'UNDER_REVIEW' ? { icon: Hourglass, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300', title: 'Held for fraud review', text: 'fraud-service flagged this transfer. An admin must approve it in the Fraud console before any balance changes. You will get a notification either way.' }
    : timedOut ? { icon: Clock, tone: 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300', title: 'Still processing', text: 'This is taking longer than usual. Check Transactions for the final status.' }
    : { icon: Radio, tone: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300', title: `Sending ${money}…`, text: `To ${recipient?.name}. Following the saga live as each service reacts.`, live: true }
  const Icon = head.icon

  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${head.tone}`}>
          {head.live && <span className="absolute inset-0 rounded-2xl bg-brand-500/30 animate-pulse-ring" aria-hidden />}
          <Icon size={24} className="relative" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="heading text-lg font-semibold" aria-live="polite">{head.title}</p>
          <p className="muted mt-0.5 text-sm leading-relaxed">{head.text}</p>
          <p className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-500 dark:bg-white/[0.04] dark:text-slate-400">
            Ref {reference || tracking.id} <CopyButton value={reference || tracking.id} label="Copy reference" />
          </p>
        </div>
      </div>

      {pollError && <div className="mt-4"><ErrorBanner error={pollError}><p className="text-xs">Lost track of the transfer. It may still complete; check Transactions.</p></ErrorBanner></div>}

      <div className="mt-6 rounded-2xl border border-slate-100 p-4 dark:border-white/[0.06] sm:p-5">
        <SagaTracker steps={steps} />
      </div>

      {done && (
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {status === 'FAILED' ? (
            <button type="button" className="btn-primary" onClick={onRetry}><RotateCcw size={16} /> Try again</button>
          ) : (
            <button type="button" className="btn-ghost" onClick={onReceipt}><Download size={16} /> Receipt</button>
          )}
          <Link to={`/transactions?q=${encodeURIComponent(reference || tracking.id)}`} className="btn-ghost">View transaction</Link>
          {status !== 'FAILED' && <button type="button" className="btn-primary" onClick={onAnother}><Send size={16} /> Send another</button>}
        </div>
      )}
    </div>
  )
}

function EventLog({ tracking }) {
  const events = sagaEventLog(sagaSteps({ status: tracking.status, history: tracking.history, failureReason: tracking.failureReason }))
  const live = !tracking.done
  return (
    <Card>
      <CardHeader
        title="Kafka events"
        subtitle="Derived from the saga's status history"
        icon={Radio}
        action={live ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>Live</span> : null}
      />
      <ol className="space-y-2 p-5 pt-4">
        {events.map((e, i) => (
          <li key={`${e.name}-${i}`} className="animate-fade-in rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="flex items-center justify-between gap-2">
              <span className={`font-mono text-xs font-semibold ${e.state === 'failed' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}>{e.name}</span>
              {e.time && <span className="tabular font-mono text-[10px] text-slate-400">{timeWithSeconds(e.time)}</span>}
            </div>
            <p className="muted mt-1 font-mono text-[10.5px]">{e.topic}</p>
            <p className="muted text-[11px]">produced by <span className="font-medium text-slate-600 dark:text-slate-300">{e.producer}</span></p>
          </li>
        ))}
        {live && (
          <li className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-400 dark:border-white/10">
            <Spinner size={13} /> Waiting for the next event…
          </li>
        )}
      </ol>
    </Card>
  )
}

function HowItWorks() {
  const items = [
    { title: 'Transfer requested', service: 'transaction-service', text: 'Saved with an outbox row, 202 returned instantly.', event: 'TRANSACTION_INITIATED' },
    { title: 'Fraud check', service: 'fraud-service', text: 'Amount, velocity, location and pattern rules.', event: 'FRAUD_CLEARED' },
    { title: 'Balance update', service: 'account-service', text: 'Debit and credit in one locked DB transaction.', event: 'BALANCE_UPDATED' },
    { title: 'Completed', service: 'transaction-service', text: 'You and the payee get notified; audit records it.', event: 'TRANSACTION_COMPLETED' },
  ]
  return (
    <Card>
      <CardHeader title="What happens when you hit send" subtitle="An event-driven saga over Kafka" icon={Zap} />
      <ol className="relative space-y-4 p-5 pt-4">
        {items.map((it, i) => (
          <li key={it.title} className="relative flex gap-3">
            {i < items.length - 1 && <span className="absolute left-[11px] top-7 h-[calc(100%-0.5rem)] w-px bg-slate-200 dark:bg-white/10" aria-hidden />}
            <span className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700 ring-4 ring-white dark:bg-brand-500/15 dark:text-brand-300 dark:ring-ink-900">{i + 1}</span>
            <div className="min-w-0">
              <p className="heading text-sm font-medium">{it.title} <span className="muted font-mono text-[10px] font-normal">{it.service}</span></p>
              <p className="muted text-xs leading-relaxed">{it.text}</p>
              <p className="mt-1 font-mono text-[10px] text-brand-600 dark:text-brand-400">{it.event}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function Limits({ currency }) {
  const f = (v) => formatCurrency(v, currency).replace(/\.00$/, '')
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"><BadgeIndianRupee size={18} /></span>
        <div className="text-sm">
          <p className="heading font-semibold">Free, instant, safe</p>
          <ul className="muted mt-1.5 space-y-1 text-xs leading-relaxed">
            <li className="flex gap-1.5"><Star size={12} className="mt-0.5 shrink-0 text-amber-500" /> No fees on Meridian-to-Meridian transfers</li>
            <li className="flex gap-1.5"><Star size={12} className="mt-0.5 shrink-0 text-amber-500" /> Up to {f(10000000)} per transfer</li>
            <li className="flex gap-1.5"><Star size={12} className="mt-0.5 shrink-0 text-amber-500" /> Above {f(REVIEW_THRESHOLD)}: held for a fraud analyst</li>
          </ul>
        </div>
      </div>
    </Card>
  )
}
