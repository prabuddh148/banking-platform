import { useState } from 'react'
import { ShieldAlert, ShieldCheck, Ban, Eye } from 'lucide-react'
import { PageHeader, Card, StatCard, StatusBadge, EmptyState } from '../../components/ui/Primitives.jsx'
import { fraudAlerts as seed } from '../../data/mockData.js'
import { formatCurrency, relativeTime } from '../../lib/format.js'
import { useApp } from '../../context/AppContext.jsx'

function RiskMeter({ score }) {
  const tone = score >= 85 ? 'text-rose-600' : score >= 60 ? 'text-amber-600' : 'text-emerald-600'
  const bar = score >= 85 ? 'bg-rose-500' : score >= 60 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="w-28">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">Risk</span>
        <span className={`font-bold ${tone}`}>{score}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
        <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}

export default function FraudAlerts() {
  const { showToast } = useApp()
  const [alerts, setAlerts] = useState(seed)
  const [filter, setFilter] = useState('all')

  function updateStatus(id, status, customer) {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)))
    showToast(`Case for ${customer} marked ${status}`)
  }

  const counts = {
    open: alerts.filter((a) => a.status === 'Open').length,
    reviewing: alerts.filter((a) => a.status === 'Reviewing').length,
    blocked: alerts.filter((a) => a.status === 'Blocked').length,
  }
  const visible = filter === 'all' ? alerts : alerts.filter((a) => a.status === filter)
  const tabs = ['all', 'Open', 'Reviewing', 'Blocked', 'Cleared']

  return (
    <>
      <PageHeader title="Fraud Alerts" subtitle="Cases raised by the fraud-service scoring pipeline." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Open cases" value={counts.open} icon={ShieldAlert} tone="red" />
        <StatCard label="Under review" value={counts.reviewing} icon={Eye} tone="amber" />
        <StatCard label="Blocked (24h)" value={counts.blocked} icon={Ban} tone="slate" />
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
          const resolved = a.status === 'Blocked' || a.status === 'Cleared'
          return (
            <Card key={a.id} className="p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${a.riskScore >= 85 ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
                    <ShieldAlert size={22} />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{a.customer}</p>
                      <StatusBadge status={a.status} />
                    </div>
                    <p className="text-sm text-slate-500">{a.reason}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {a.accountNumber} · {formatCurrency(a.amount)} · {a.txnId} · {relativeTime(a.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 lg:gap-6">
                  <RiskMeter score={a.riskScore} />
                  <div className="flex gap-2">
                    <button
                      className="btn-ghost"
                      disabled={resolved}
                      onClick={() => updateStatus(a.id, 'Cleared', a.customer)}
                    >
                      <ShieldCheck size={15} /> Clear
                    </button>
                    <button
                      className="btn bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-500"
                      disabled={resolved}
                      onClick={() => updateStatus(a.id, 'Blocked', a.customer)}
                    >
                      <Ban size={15} /> Block
                    </button>
                  </div>
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
