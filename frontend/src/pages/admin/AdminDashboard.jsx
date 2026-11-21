import { Link } from 'react-router-dom'
import { Users, Landmark, Receipt, Banknote, ShieldAlert, Clock, Activity, RefreshCw, ShieldCheck } from 'lucide-react'
import { PageHeader, Card, StatCard, BarChart, StatusBadge, AsyncView, ErrorBanner, Spinner } from '../../components/ui/Primitives.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { getAdminOverview } from '../../services/dashboardService.js'
import { formatCurrency, formatNumber } from '../../lib/format.js'

export default function AdminDashboard() {
  const state = useAsync(() => getAdminOverview(), [])

  return (
    <>
      <PageHeader
        title="Operations Dashboard"
        subtitle="Platform-wide health and activity across all services."
        action={
          <button className="btn-ghost" onClick={state.reload} disabled={state.loading}>
            {state.loading ? <Spinner /> : <RefreshCw size={16} />} Refresh
          </button>
        }
      />
      <AsyncView state={state} card loadingLabel="Collecting platform metrics…" errorTitle="Couldn't load the dashboard">
        {(data) => <Overview data={data} />}
      </AsyncView>
    </>
  )
}

function Overview({ data }) {
  const { metrics, currency, hourlyVolume, services, openAlerts, statusBreakdown, sampleNote, errors } = data
  const degraded = services.filter((s) => s.status !== 'Operational')
  const maxStatus = Math.max(...statusBreakdown.map((s) => s.count), 1)

  return (
    <>
      {errors.length > 0 && (
        <div className="mb-4">
          <ErrorBanner>
            <p className="font-medium">Some panels could not be loaded:</p>
            <ul className="mt-1 list-disc pl-4 text-xs">
              {errors.map((e) => <li key={e.label}>{e.label}: {e.message}</li>)}
            </ul>
          </ErrorBanner>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Customers" value={formatNumber(metrics.customers)} icon={Users} tone="brand" />
        <StatCard label="Accounts" value={formatNumber(metrics.accounts)} icon={Landmark} tone="slate" />
        <StatCard label="Txns (24h)" value={formatNumber(metrics.transactions24h)} icon={Receipt} tone="blue" />
        <StatCard label="Volume (24h)" value={metrics.volume24h === null ? '—' : formatCurrency(metrics.volume24h, currency)} icon={Banknote} tone="green" />
        <StatCard label="Open fraud" value={formatNumber(metrics.openFraud)} icon={ShieldAlert} tone="red" />
        <StatCard label="Under review" value={formatNumber(metrics.underReview)} icon={Clock} tone="amber" />
      </div>
      {sampleNote && <p className="mt-2 text-xs text-slate-400">{sampleNote}.</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Volume chart */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Transaction volume</h2>
              <p className="text-sm text-slate-500">Transactions per hour · last 24h</p>
            </div>
            <span className="text-2xl font-bold text-slate-900">{formatNumber(hourlyVolume.reduce((a, b) => a + b, 0))}</span>
          </div>
          <div className="mt-5">
            <BarChart data={hourlyVolume} height={160} />
          </div>
        </Card>

        {/* Service health */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Service health</h2>
            <Link to="/admin/services"><Activity size={18} className={degraded.length ? 'text-amber-500' : 'text-emerald-500'} /></Link>
          </div>
          {services.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No health data available.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {services.map((s) => (
                <li key={s.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${s.status === 'Operational' ? 'bg-emerald-500' : s.status === 'Down' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                    <span className="text-sm font-medium text-slate-700">{s.name}</span>
                  </div>
                  <span className="text-xs text-slate-500">{s.latencyMs != null ? `${s.latencyMs} ms` : s.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Status breakdown */}
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">Transactions by status</h2>
          <p className="text-sm text-slate-500">Where recent transactions are in the saga</p>
          {statusBreakdown.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No transactions yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {statusBreakdown.map((s) => (
                <li key={s.status}>
                  <div className="flex items-center justify-between text-sm">
                    <StatusBadge status={s.status} />
                    <span className="font-medium text-slate-800">{formatNumber(s.count)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-brand-500" style={{ width: `${(s.count / maxStatus) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Fraud queue */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Fraud review queue</h2>
            <Link to="/admin/fraud" className="text-sm font-medium text-rose-600">{openAlerts.length} open</Link>
          </div>
          {openAlerts.length === 0 ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-slate-500"><ShieldCheck size={18} className="text-emerald-500" /> Nothing waiting for review.</div>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {openAlerts.slice(0, 4).map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{f.customer}</p>
                    <p className="truncate text-xs text-slate-500">{f.reason} · {formatCurrency(f.amount, f.currency)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${f.riskScore >= 80 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                      {f.riskScore}
                    </span>
                    <StatusBadge status={f.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
