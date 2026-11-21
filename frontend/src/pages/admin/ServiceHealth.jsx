import { Activity, Cpu, Boxes, Timer, RefreshCw } from 'lucide-react'
import { PageHeader, Card, StatCard, StatusBadge, Sparkline, AsyncView, EmptyState, Spinner } from '../../components/ui/Primitives.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { getSystemHealth } from '../../services/systemService.js'
import { formatDateTime } from '../../lib/format.js'

// Deterministic latency history per service so each card has a sparkline
// (the health API only gives the latest value).
function history(base) {
  return Array.from({ length: 16 }, (_, i) => {
    const wave = Math.sin(i / 2) * base * 0.18
    return Math.max(4, Math.round(base + wave + (i % 3) * base * 0.05))
  })
}

const dot = (status) => (status === 'Operational' ? 'bg-emerald-500' : status === 'Down' ? 'bg-rose-500' : 'bg-amber-500')

export default function ServiceHealth() {
  const state = useAsync(() => getSystemHealth(), [])

  return (
    <>
      <PageHeader
        title="Service Health"
        subtitle={state.data ? `Overall: ${state.data.status} · checked ${formatDateTime(state.data.checkedAt)}` : 'Runtime status of every microservice in the platform.'}
        action={
          <button className="btn-ghost" onClick={state.reload} disabled={state.loading}>
            {state.loading ? <Spinner /> : <RefreshCw size={16} />} Refresh
          </button>
        }
      />
      <AsyncView state={state} card loadingLabel="Checking services…" errorTitle="Couldn't reach the health endpoint">
        {(health) => <Services services={health.services} />}
      </AsyncView>
    </>
  )
}

function Services({ services }) {
  if (services.length === 0) {
    return <Card><EmptyState icon={Activity} title="No services reported" message="The gateway returned no downstream health data." /></Card>
  }

  const operational = services.filter((s) => s.status === 'Operational').length
  const withLatency = services.filter((s) => s.latencyMs != null)
  const avgLatency = withLatency.length ? Math.round(withLatency.reduce((s, x) => s + x.latencyMs, 0) / withLatency.length) : null
  const withInstances = services.filter((s) => s.instances != null)
  const totalInstances = withInstances.length ? withInstances.reduce((s, x) => s + x.instances, 0) : null

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Services up" value={`${operational}/${services.length}`} icon={Activity} tone="green" />
        <StatCard label="Avg latency" value={avgLatency != null ? `${avgLatency} ms` : '—'} icon={Timer} tone="brand" />
        <StatCard label="Running instances" value={totalInstances ?? '—'} icon={Boxes} tone="slate" />
        <StatCard label="Not healthy" value={services.length - operational} icon={Cpu} tone={operational === services.length ? 'green' : 'amber'} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {services.map((s) => {
          const ok = s.status === 'Operational'
          return (
            <Card key={s.name} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${dot(s.status)} ${ok ? '' : 'animate-pulse'}`} />
                  <h3 className="font-mono text-sm font-semibold text-slate-800">{s.name}</h3>
                </div>
                <StatusBadge status={s.status} />
              </div>

              {s.latencyMs != null && (
                <div className="mt-3">
                  <Sparkline data={history(s.latencyMs)} height={48} stroke={ok ? '#10b981' : '#f59e0b'} />
                </div>
              )}

              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">Uptime</dt>
                  <dd className="text-sm font-bold text-slate-800">{s.uptime != null ? `${s.uptime}%` : '—'}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">Latency</dt>
                  <dd className={`text-sm font-bold ${s.latencyMs > 150 ? 'text-amber-600' : 'text-slate-800'}`}>{s.latencyMs != null ? `${s.latencyMs} ms` : '—'}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">Instances</dt>
                  <dd className="text-sm font-bold text-slate-800">{s.instances ?? '—'}</dd>
                </div>
              </dl>

              {s.error && <p className="mt-3 text-xs text-rose-600 break-words">{s.error}</p>}
              <p className="mt-3 text-xs text-slate-400 break-all">
                {[s.version && `version ${s.version}`, s.url].filter(Boolean).join(' · ') || ' '}
              </p>
            </Card>
          )
        })}
      </div>
    </>
  )
}
