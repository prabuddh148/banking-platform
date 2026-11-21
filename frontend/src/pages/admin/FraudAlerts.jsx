import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ShieldAlert, ShieldCheck, Ban, Globe2, Inbox, Keyboard, Gavel, Radio, ArrowRightLeft, Clock, UserCheck } from 'lucide-react'
import { PageHeader, Card, Segmented, EmptyState, Spinner, Modal, Drawer, Timeline, Avatar, StatusBadge, ErrorState, Skeleton, CopyButton } from '../../components/ui/Primitives.jsx'
import { RiskGauge } from '../../components/ui/Charts.jsx'
import { RiskScore, RiskLevelBadge, RiskBandsLegend, RefreshButton, riskMeta } from '../../components/admin/AdminBits.jsx'
import { useMediaQuery, isTypingTarget } from '../../components/admin/hooks.js'
import { useApp } from '../../context/AppContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { listAllAccounts } from '../../services/accountService.js'
import { listAlerts, reviewAlert, FRAUD_RULES } from '../../services/fraudService.js'
import { formatCurrency, formatDateTime, relativeTime } from '../../lib/format.js'
import { shortId } from '../../services/mappers.js'

async function load() {
  const accounts = await listAllAccounts().then((r) => r.items).catch(() => [])
  return listAlerts({ accounts })
}

const FILTERS = ['Open', 'Approved', 'Rejected', 'all']

export default function FraudAlerts() {
  const state = useAsync(load, [])
  const open = state.data?.filter((a) => a.status === 'Open').length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="fraud-service"
        title="Fraud review"
        subtitle={state.data ? `${open} case${open === 1 ? '' : 's'} waiting for an analyst. Decisions resume the paused transfer saga.` : 'Cases raised by the fraud-service rule engine.'}
        action={<RefreshButton loading={state.loading} onClick={state.reload} />}
      />
      <RiskBandsLegend />
      {state.error ? (
        <Card><ErrorState error={state.error} onRetry={state.reload} title="Couldn't load fraud alerts" /></Card>
      ) : state.data === undefined ? (
        <QueueSkeleton />
      ) : (
        <Queue
          alerts={state.data}
          onUpdated={(updated) => state.setData((list) => list.map((a) => (a.id === updated.id ? { ...a, ...updated, customer: a.customer, accountNumber: a.accountNumber, ruleScores: a.ruleScores, clientCountry: a.clientCountry, transactionType: a.transactionType } : a)))}
        />
      )}
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Card className="space-y-3 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</Card>
      <Card className="hidden space-y-4 p-6 lg:block"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-40 w-full" /><Skeleton className="h-24 w-full" /></Card>
    </div>
  )
}

function Queue({ alerts, onUpdated }) {
  const { showToast } = useApp()
  const isLg = useMediaQuery('(min-width: 1024px)')
  const [filter, setFilter] = useState('Open')
  const [sort, setSort] = useState('risk')
  const [params] = useSearchParams()
  const [selectedId, setSelectedId] = useState(() => params.get('alert'))
  const [drawerOpen, setDrawerOpen] = useState(() => Boolean(params.get('alert')))
  const [confirm, setConfirm] = useState(null) // 'APPROVE' | 'REJECT'
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const count = (s) => alerts.filter((a) => a.status === s).length
  const visible = useMemo(() => {
    const list = filter === 'all' ? alerts : alerts.filter((a) => a.status === filter)
    return [...list].sort((a, b) => (sort === 'risk' ? b.riskScore - a.riskScore || new Date(b.createdAt) - new Date(a.createdAt) : new Date(b.createdAt) - new Date(a.createdAt)))
  }, [alerts, filter, sort])

  const selected = alerts.find((a) => a.id === selectedId) || null

  // Desktop: keep something selected
  useEffect(() => {
    if (isLg && (!selectedId || !visible.some((a) => a.id === selectedId)) && visible.length) setSelectedId(visible[0].id)
  }, [isLg, visible, selectedId])

  useEffect(() => setNotes(''), [selectedId])

  const select = useCallback((id) => {
    setSelectedId(id)
    if (!isLg) setDrawerOpen(true)
  }, [isLg])

  // J/K to move, A/R to decide
  useEffect(() => {
    const onKey = (e) => {
      if (isTypingTarget(e) || e.metaKey || e.ctrlKey || e.altKey || confirm) return
      const k = e.key.toLowerCase()
      const idx = visible.findIndex((a) => a.id === selectedId)
      if (k === 'j' || k === 'k') {
        e.preventDefault()
        const next = visible[Math.min(visible.length - 1, Math.max(0, idx + (k === 'j' ? 1 : -1)))]
        if (next) setSelectedId(next.id)
      } else if ((k === 'a' || k === 'r') && selected?.status === 'Open') {
        e.preventDefault()
        setConfirm(k === 'a' ? 'APPROVE' : 'REJECT')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, selectedId, selected, confirm])

  async function decide() {
    if (!selected || !confirm) return
    setBusy(true)
    try {
      const updated = await reviewAlert(selected.id, confirm, notes.trim())
      onUpdated(updated)
      const approved = confirm === 'APPROVE'
      showToast({
        title: approved ? 'Alert approved' : 'Alert rejected',
        description: approved ? `FRAUD_CLEARED published · ${selected.customer}'s transfer resumes.` : `FRAUD_DETECTED (BLOCK) published · transaction fails with FRAUD_BLOCKED.`,
        tone: approved ? 'success' : 'info',
      })
      setConfirm(null)
      // move on to the next open case
      const nextOpen = visible.find((a) => a.id !== selected.id && a.status === 'Open')
      if (nextOpen && filter === 'Open') setSelectedId(nextOpen.id)
    } catch (err) {
      showToast({ title: 'Review failed', description: err.message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const detail = selected && (
    <AlertDetail alert={selected} notes={notes} setNotes={setNotes} onDecide={setConfirm} busy={busy} bare={!isLg} />
  )

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* Inbox */}
        <Card className="flex flex-col overflow-hidden lg:max-h-[820px] lg:self-start">
          <div className="space-y-3 border-b border-slate-100 p-4 dark:border-white/[0.06]">
            <Segmented
              size="sm"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({ value: f, label: f === 'all' ? 'All' : f, count: f === 'all' ? alerts.length : count(f) }))}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="muted flex items-center gap-2 text-xs">
                Sort
                <select className="input w-auto py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort alerts">
                  <option value="risk">Highest risk</option>
                  <option value="time">Newest first</option>
                </select>
              </label>
              <span className="hidden items-center gap-1 whitespace-nowrap text-[11px] text-slate-400 lg:inline-flex" title="J/K move · A approve · R reject">
                <Keyboard size={12} /> <span className="kbd">J</span><span className="kbd">K</span><span className="kbd">A</span><span className="kbd">R</span>
              </span>
            </div>
          </div>
          {visible.length === 0 ? (
            <EmptyState icon={filter === 'Open' ? ShieldCheck : Inbox} title={filter === 'Open' ? 'Queue is clear' : 'No cases here'} message={filter === 'Open' ? 'Every flagged transaction has been reviewed. Nice work.' : 'Nothing in this state right now.'} />
          ) : (
            <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto scrollbar-thin dark:divide-white/[0.05]">
              {visible.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => select(a.id)}
                    className={`relative flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors ${selectedId === a.id ? 'bg-brand-50/70 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'}`}
                  >
                    {selectedId === a.id && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-brand-600 dark:bg-brand-400" />}
                    <RiskScore score={a.riskScore} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="heading truncate text-sm font-semibold">{a.customer}</span>
                        <span className="heading tabular shrink-0 text-sm font-semibold">{formatCurrency(a.amount, a.currency)}</span>
                      </span>
                      <span className="muted mt-0.5 block truncate text-xs">{a.reason}</span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <RiskLevelBadge level={a.riskLevel} />
                        {a.status !== 'Open' && <StatusBadge status={a.status} />}
                        <span className="ml-auto text-[11px] text-slate-400">{relativeTime(a.createdAt)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="hidden border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400 lg:block dark:border-white/[0.06]">
            <span className="kbd">J</span> / <span className="kbd">K</span> next / previous · <span className="kbd">A</span> approve · <span className="kbd">R</span> reject
          </p>
        </Card>

        {/* Detail */}
        {isLg && (
          <div className="min-w-0">
            {detail || <Card><EmptyState icon={ShieldAlert} title="Select a case" message="Pick an alert from the queue to review it." /></Card>}
          </div>
        )}
      </div>

      {!isLg && (
        <Drawer open={drawerOpen && Boolean(selected)} onClose={() => setDrawerOpen(false)} title="Review alert" subtitle={selected ? `${selected.id} · ${selected.riskLevel} risk` : ''} width="max-w-xl">
          {detail}
        </Drawer>
      )}

      <Modal
        open={Boolean(confirm)}
        onClose={() => !busy && setConfirm(null)}
        title={confirm === 'APPROVE' ? 'Approve this transaction?' : 'Reject this transaction?'}
        subtitle={selected ? `${selected.customer} · ${formatCurrency(selected.amount, selected.currency)} · risk ${selected.riskScore}` : ''}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
            <button type="button" className={confirm === 'APPROVE' ? 'btn-success' : 'btn-danger'} onClick={decide} disabled={busy}>
              {busy ? <Spinner size={15} /> : confirm === 'APPROVE' ? <ShieldCheck size={15} /> : <Ban size={15} />}
              {confirm === 'APPROVE' ? 'Approve & release' : 'Reject & block'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {confirm === 'APPROVE'
            ? 'fraud-service publishes FRAUD_CLEARED. transaction-service moves the saga to PROCESSING and asks account-service to move the money.'
            : 'fraud-service publishes FRAUD_DETECTED with decision BLOCK. The transaction fails with FRAUD_BLOCKED and the customer is notified.'}
        </p>
        {notes.trim() ? (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm italic text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">“{notes.trim()}”</p>
        ) : (
          <p className="muted mt-3 text-xs">No review notes added. Notes are stored on the alert and in the audit trail.</p>
        )}
      </Modal>
    </>
  )
}

function AlertDetail({ alert: a, notes, setNotes, onDecide, busy, bare = false }) {
  const Wrap = bare ? 'div' : Card
  const ruleEntries = Object.entries(a.ruleScores || {})
  const ruleTotal = ruleEntries.reduce((s, [, v]) => s + v, 0)
  const level = riskMeta(a.riskLevel)
  const outside = a.clientCountry && a.clientCountry !== 'IN'
  const created = new Date(a.createdAt).getTime()
  const at = (ms) => formatDateTime(new Date(created + ms).toISOString())

  const timeline = [
    { title: 'TRANSACTION_INITIATED', description: `${a.transactionType || 'Transaction'} accepted by transaction-service (202)`, time: at(-1400), state: 'done', icon: ArrowRightLeft },
    { title: `Rules evaluated · score ${a.riskScore}`, description: `${a.triggeredRules.length} rule${a.triggeredRules.length === 1 ? '' : 's'} triggered → ${a.riskLevel}`, time: at(-300), state: 'done', icon: Gavel },
    a.riskLevel === 'CRITICAL'
      ? { title: 'FRAUD_DETECTED · BLOCK', description: 'Auto-blocked: transaction FAILED (FRAUD_BLOCKED)', time: at(0), state: 'failed', icon: Ban }
      : { title: 'FRAUD_DETECTED · REVIEW', description: 'Alert opened, saga paused in AWAITING_REVIEW', time: at(0), state: 'warning', icon: ShieldAlert },
    a.status === 'Open'
      ? { title: 'Awaiting analyst decision', description: `Waiting ${relativeTime(a.createdAt).replace(' ago', '')} · reviews never time out`, state: 'current', icon: Clock }
      : a.riskLevel === 'CRITICAL' && a.reviewedBy === 'SYSTEM'
        ? null
        : { title: a.status === 'Approved' ? 'Approved · FRAUD_CLEARED' : 'Rejected · FRAUD_DETECTED (BLOCK)', description: `by ${a.reviewedBy || 'admin'}${a.reviewNotes ? ` · “${a.reviewNotes}”` : ''}`, time: a.reviewedAt ? formatDateTime(a.reviewedAt) : undefined, state: a.status === 'Approved' ? 'done' : 'failed', icon: UserCheck },
  ].filter(Boolean)

  return (
    <Wrap className={bare ? '-mx-5 -my-5' : 'overflow-hidden'}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5 dark:border-white/[0.06]">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={a.customer} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="heading truncate text-lg font-semibold">{a.customer}</h2>
              <StatusBadge status={a.status} />
            </div>
            <p className="muted text-xs">Alert <span className="font-mono">{a.id}</span> · raised {relativeTime(a.createdAt)} · {formatDateTime(a.createdAt)}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="muted text-xs">Amount</p>
          <p className="heading tabular text-2xl font-bold tracking-tight">{formatCurrency(a.amount, a.currency)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 p-5 md:grid-cols-[220px_minmax(0,1fr)]">
        {/* Gauge */}
        <div className="flex flex-col items-center justify-center rounded-2xl bg-slate-50 px-3 py-5 dark:bg-white/[0.03]">
          <RiskGauge score={a.riskScore} size={190} />
          <p className="mt-3 text-center text-xs font-medium text-slate-600 dark:text-slate-300">
            Decision band: <span className="font-semibold text-slate-900 dark:text-white">{level.decision}</span>
          </p>
        </div>
        {/* Rules */}
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="heading text-sm font-semibold">Triggered rules</h3>
            <span className="muted tabular text-xs">Σ {ruleTotal} → capped at 100</span>
          </div>
          {ruleEntries.length === 0 ? (
            <p className="muted text-sm">No rule details on this alert.</p>
          ) : (
            <ul className="space-y-3">
              {ruleEntries.map(([rule, score]) => (
                <li key={rule}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-slate-800 dark:text-slate-100">{FRAUD_RULES[rule]?.label || rule}</span>
                      <span className="ml-2 font-mono text-[11px] text-slate-400">{rule}</span>
                    </span>
                    <span className="heading tabular shrink-0 font-semibold">+{score}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-slate-100 dark:bg-white/[0.06]">
                    <div className="h-2 rounded-full" style={{ width: `${Math.min(100, score)}%`, background: 'var(--series-1)' }} />
                  </div>
                  {FRAUD_RULES[rule] && <p className="muted mt-1 text-[11px]">{FRAUD_RULES[rule].description}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Facts */}
      <div className="grid grid-cols-2 gap-px border-y border-slate-100 bg-slate-100 sm:grid-cols-3 dark:border-white/[0.06] dark:bg-white/[0.06]">
        <Fact label="Type" value={a.transactionType || '—'} />
        <Fact label="Country" value={a.clientCountry ? (
          <span className="inline-flex items-center gap-1.5">
            <span className={`rounded px-1.5 py-px font-mono text-xs font-semibold ${outside ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200' : 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'}`}>{a.clientCountry}</span>
            {outside && <Globe2 size={13} className="text-amber-600 dark:text-amber-300" aria-label="Outside India" />}
          </span>
        ) : '—'} hint={outside ? 'Outside allowed [IN]' : undefined} />
        <Fact label="Account" value={<span className="font-mono text-xs">{a.accountNumber}</span>} />
        <Fact label="Transaction" value={<span className="inline-flex items-center gap-1 font-mono text-xs">{shortId(a.txnId)}<CopyButton value={a.txnId} label="Copy transaction ID" /></span>} />
        <Fact label="Risk level" value={<RiskLevelBadge level={a.riskLevel} />} />
        <Fact label="Raised" value={relativeTime(a.createdAt)} />
      </div>

      <div className="grid grid-cols-1 gap-6 p-5 xl:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="heading text-sm font-semibold">Saga timeline</h3>
            <Link to={`/admin/audit?q=${encodeURIComponent(a.txnId)}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"><Radio size={12} /> Audit trail</Link>
          </div>
          <Timeline items={timeline} />
        </div>

        <div>
          <h3 className="heading mb-3 text-sm font-semibold">Decision</h3>
          {a.status === 'Open' ? (
            <div className="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
              <label htmlFor="review-notes" className="label">Review notes</label>
              <textarea
                id="review-notes"
                className="input min-h-[96px] resize-y"
                maxLength={2000}
                placeholder="e.g. Customer confirmed on a recorded call; travelling in Dubai."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <p className="muted mt-1 text-right text-[11px] tabular">{notes.length}/2000</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="btn-success" disabled={busy} onClick={() => onDecide('APPROVE')}>
                  <ShieldCheck size={15} /> Approve <span className="kbd ml-1 border-white/30 bg-white/15 text-white">A</span>
                </button>
                <button type="button" className="btn-danger" disabled={busy} onClick={() => onDecide('REJECT')}>
                  <Ban size={15} /> Reject <span className="kbd ml-1 border-white/30 bg-white/15 text-white">R</span>
                </button>
              </div>
            </div>
          ) : (
            <div className={`rounded-2xl border p-4 ${a.status === 'Approved' ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-400/20 dark:bg-emerald-500/10' : 'border-rose-200 bg-rose-50/60 dark:border-rose-400/20 dark:bg-rose-500/10'}`}>
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                {a.status === 'Approved' ? <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-300" /> : <Ban size={16} className="text-rose-600 dark:text-rose-300" />}
                {a.status === 'Approved' ? 'Approved, transaction released' : a.reviewedBy === 'SYSTEM' ? 'Blocked automatically (CRITICAL)' : 'Rejected, transaction blocked'}
              </p>
              <p className="muted mt-1 text-xs">Reviewed by <span className="font-mono">{a.reviewedBy || 'admin'}</span>{a.reviewedAt ? ` · ${formatDateTime(a.reviewedAt)}` : ''}</p>
              {a.reviewNotes && <p className="mt-2 text-sm italic text-slate-600 dark:text-slate-300">“{a.reviewNotes}”</p>}
            </div>
          )}
          <p className="muted mt-3 text-xs">{a.reason}</p>
        </div>
      </div>
    </Wrap>
  )
}

function Fact({ label, value, hint }) {
  return (
    <div className="bg-white px-4 py-3 dark:bg-ink-900">
      <p className="muted text-[11px] font-medium uppercase tracking-wide">{label}</p>
      <div className="heading mt-1 truncate text-sm font-semibold">{value}</div>
      {hint && <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">{hint}</p>}
    </div>
  )
}
