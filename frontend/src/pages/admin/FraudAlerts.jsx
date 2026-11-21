import { useState } from 'react'
import { ShieldAlert, ShieldCheck, Ban, CheckCircle2, RefreshCw } from 'lucide-react'
import { PageHeader, Card, StatCard, StatusBadge, EmptyState, AsyncView, Spinner, Badge } from '../../components/ui/Primitives.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { listAllAccounts } from '../../services/accountService.js'
import { listAlerts, reviewAlert } from '../../services/fraudService.js'
import { formatCurrency, relativeTime } from '../../lib/format.js'
import { shortId } from '../../services/mappers.js'

function RiskMeter({ score }) {
  const tone = score >= 80 ? 'text-rose-600' : score >= 60 ? 'text-amber-600' : 'text-emerald-600'
  const bar = score >= 80 ? 'bg-rose-500' : score >= 60 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="w-28">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">Risk</span>
        <span className={`font-bold ${tone}`}>{score}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
        <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
    </div>
  )
}

async function load() {
  const accounts = await listAllAccounts().then((r) => r.items).catch(() => [])
  return listAlerts({ accounts })
}

export default function FraudAlerts() {
  const state = useAsync(load, [])

  return (
    <>
      <PageHeader
        title="Fraud Alerts"
        subtitle="Cases raised by the fraud-service scoring pipeline."
        action={
          <button className="btn-ghost" onClick={state.reload} disabled={state.loading}>
            {state.loading ? <Spinner /> : <RefreshCw size={16} />} Refresh
          </button>
        }
      />
      <AsyncView state={state} card loadingLabel="Loading fraud alerts…" errorTitle="Couldn't load fraud alerts">
        {(alerts) => (
          <AlertList
            alerts={alerts}
            onUpdated={(updated) => state.setData((list) => list.map((a) => (a.id === updated.id ? { ...a, ...updated, customer: a.customer, accountNumber: a.accountNumber } : a)))}
          />
        )}
      </AsyncView>
    </>
  )
}

function AlertList({ alerts, onUpdated }) {
  const { showToast } = useApp()
  const [filter, setFilter] = useState('Open')
  const [pending, setPending] = useState(null) // `${id}:${decision}`

  async function review(alert, decision) {
    const verb = decision === 'APPROVE' ? 'Approve' : 'Reject'
    const notes = window.prompt(`${verb} the transaction for ${alert.customer}?\nReview notes (optional):`, '')
    if (notes === null) return
    setPending(`${alert.id}:${decision}`)
    try {
      const updated = await reviewAlert(alert.id, decision, notes)
      onUpdated(updated)
      showToast(decision === 'APPROVE' ? 'Alert approved — transaction released' : 'Alert rejected — transaction blocked')
    } catch (err) {
      showToast(err.message || 'Review failed', 'error')
    } finally {
      setPending(null)
    }
  }

  const count = (s) => alerts.filter((a) => a.status === s).length
  const visible = filter === 'all' ? alerts : alerts.filter((a) => a.status === filter)
  const tabs = ['Open', 'Approved', 'Rejected', 'all']

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Open cases" value={count('Open')} icon={ShieldAlert} tone="red" />
        <StatCard label="Approved" value={count('Approved')} icon={CheckCircle2} tone="green" />
        <StatCard label="Rejected" value={count('Rejected')} icon={Ban} tone="slate" />
      </div>

      <div className="mt-6 mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              filter === t ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t === 'all' ? 'All' : t}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {visible.map((a) => {
          const resolved = a.status !== 'Open'
          return (
            <Card key={a.id} className="p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${a.riskScore >= 80 ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
                    <ShieldAlert size={22} />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{a.customer}</p>
                      <StatusBadge status={a.status} />
                      {a.riskLevel && <Badge tone={a.riskLevel === 'CRITICAL' ? 'red' : 'amber'}>{a.riskLevel}</Badge>}
                    </div>
                    <p className="text-sm text-slate-500">{a.reason}</p>
                    {a.triggeredRules?.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {a.triggeredRules.map((r) => <span key={r} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">{r}</span>)}
                      </div>
                    )}
                    <p className="mt-1 text-xs text-slate-400">
                      {a.accountNumber} · {formatCurrency(a.amount, a.currency)} · txn <span className="font-mono" title={a.txnId}>{shortId(a.txnId)}</span> · {relativeTime(a.createdAt)}
                      {a.reviewedBy && ` · reviewed by ${a.reviewedBy}`}
                    </p>
                    {a.reviewNotes && <p className="mt-1 text-xs italic text-slate-500">“{a.reviewNotes}”</p>}
                  </div>
                </div>

                <div className="flex items-center gap-4 lg:gap-6">
                  <RiskMeter score={a.riskScore} />
                  {!resolved && (
                    <div className="flex gap-2">
                      <button className="btn-ghost" disabled={Boolean(pending)} onClick={() => review(a, 'APPROVE')}>
                        {pending === `${a.id}:APPROVE` ? <Spinner size={15} /> : <ShieldCheck size={15} />} Approve
                      </button>
                      <button
                        className="btn bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-500"
                        disabled={Boolean(pending)}
                        onClick={() => review(a, 'REJECT')}
                      >
                        {pending === `${a.id}:REJECT` ? <Spinner size={15} /> : <Ban size={15} />} Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
        {visible.length === 0 && (
          <Card><EmptyState icon={ShieldCheck} title="No cases here" message="Nothing in this state right now." /></Card>
        )}
      </div>
    </>
  )
}
