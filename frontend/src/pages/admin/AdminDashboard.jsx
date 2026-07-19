import { Users, Landmark, Receipt, DollarSign, ShieldAlert, Gauge, Activity } from 'lucide-react'
import { PageHeader, Card, StatCard, BarChart, StatusBadge } from '../../components/ui/Primitives.jsx'
import { adminMetrics, platformTxnVolume, services, eventPipeline, fraudAlerts } from '../../data/mockData.js'
import { formatCurrency, formatNumber } from '../../lib/format.js'

export default function AdminDashboard() {
  const openCases = fraudAlerts.filter((f) => f.status === 'Open' || f.status === 'Reviewing')
  const degraded = services.filter((s) => s.status !== 'Operational')

  return (
    <>
      <PageHeader title="Operations Dashboard" subtitle="Platform-wide health and activity across all services." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Customers" value={formatNumber(adminMetrics.totalCustomers)} icon={Users} tone="brand" />
        <StatCard label="Accounts" value={formatNumber(adminMetrics.totalAccounts)} icon={Landmark} tone="slate" />
        <StatCard label="Txns today" value={formatNumber(adminMetrics.transactionsToday)} icon={Receipt} tone="blue" delta={{ up: true, label: '8.1% vs yesterday' }} />
        <StatCard label="Volume today" value={formatCurrency(adminMetrics.transactionVolumeToday)} icon={DollarSign} tone="green" />
        <StatCard label="Open fraud" value={adminMetrics.openFraudCases} icon={ShieldAlert} tone="red" />
        <StatCard label="Approval p50" value={`${adminMetrics.avgApprovalLatencyMs} ms`} icon={Gauge} tone="amber" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Volume chart */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Transaction volume</h2>
              <p className="text-sm text-slate-500">Transactions per hour · last 24h</p>
            </div>
            <span className="text-2xl font-bold text-slate-900">{formatNumber(platformTxnVolume.reduce((a, b) => a + b, 0))}</span>
          </div>
          <div className="mt-5">
            <BarChart data={platformTxnVolume} height={160} />
          </div>
        </Card>

        {/* Service health */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Service health</h2>
            <Activity size={18} className={degraded.length ? 'text-amber-500' : 'text-emerald-500'} />
          </div>
          <ul className="mt-4 space-y-3">
            {services.map((s) => (
              <li key={s.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${s.status === 'Operational' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="text-sm font-medium text-slate-700">{s.name}</span>
                </div>
                <span className="text-xs text-slate-500">{s.latencyMs} ms</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Event pipeline */}
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">Kafka event pipeline</h2>
          <p className="text-sm text-slate-500">Consumer lag & throughput by topic</p>
          <div className="mt-4 overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="pb-2">Topic</th>
                  <th className="pb-2 text-right">Lag</th>
                  <th className="pb-2 text-right">Msg/s</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {eventPipeline.map((e) => (
                  <tr key={e.topic}>
                    <td className="py-2 font-mono text-xs text-slate-700">{e.topic}</td>
                    <td className={`py-2 text-right font-medium ${e.lag > 1000 ? 'text-rose-600' : e.lag > 100 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {formatNumber(e.lag)}
                    </td>
                    <td className="py-2 text-right text-slate-600">{e.throughput}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Fraud queue */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Fraud review queue</h2>
            <span className="text-sm font-medium text-rose-600">{openCases.length} open</span>
          </div>
          <ul className="mt-4 divide-y divide-slate-100">
            {openCases.slice(0, 4).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{f.customer}</p>
                  <p className="truncate text-xs text-slate-500">{f.reason}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${f.riskScore >= 85 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                    {f.riskScore}
                  </span>
                  <StatusBadge status={f.status} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
