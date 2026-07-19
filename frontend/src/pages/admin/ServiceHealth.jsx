import { Activity, Cpu, Boxes, Timer } from 'lucide-react'
import { PageHeader, Card, StatCard, StatusBadge, Sparkline } from '../../components/ui/Primitives.jsx'
import { services } from '../../data/mockData.js'

// A little deterministic latency history per service so each card has a sparkline
// without needing Math.random (which isn't available in this environment's scripts,
// and keeps renders stable here too).
function history(base) {
  return Array.from({ length: 16 }, (_, i) => {
    const wave = Math.sin(i / 2) * base * 0.18
    return Math.max(4, Math.round(base + wave + (i % 3) * base * 0.05))
  })
}

export default function ServiceHealth() {
  const operational = services.filter((s) => s.status === 'Operational').length
  const avgLatency = Math.round(services.reduce((s, x) => s + x.latencyMs, 0) / services.length)
  const totalInstances = services.reduce((s, x) => s + x.instances, 0)

  return (
    <>
      <PageHeader title="Service Health" subtitle="Runtime status of every microservice in the platform." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Services up" value={`${operational}/${services.length}`} icon={Activity} tone="green" />
        <StatCard label="Avg latency" value={`${avgLatency} ms`} icon={Timer} tone="brand" />
        <StatCard label="Running instances" value={totalInstances} icon={Boxes} tone="slate" />
        <StatCard label="Degraded" value={services.length - operational} icon={Cpu} tone={operational === services.length ? 'green' : 'amber'} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {services.map((s) => {
          const ok = s.status === 'Operational'
          return (
            <Card key={s.name} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'} ${ok ? '' : 'animate-pulse'}`} />
                  <h3 className="font-mono text-sm font-semibold text-slate-800">{s.name}</h3>
                </div>
                <StatusBadge status={s.status} />
              </div>

              <div className="mt-3">
                <Sparkline data={history(s.latencyMs)} height={48} stroke={ok ? '#10b981' : '#f59e0b'} />
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">Uptime</dt>
                  <dd className="text-sm font-bold text-slate-800">{s.uptime}%</dd>
                </div>
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">Latency</dt>
                  <dd className={`text-sm font-bold ${s.latencyMs > 150 ? 'text-amber-600' : 'text-slate-800'}`}>{s.latencyMs} ms</dd>
                </div>
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">Pods</dt>
                  <dd className="text-sm font-bold text-slate-800">{s.instances}</dd>
                </div>
              </dl>

              <p className="mt-3 text-xs text-slate-400">version {s.version}</p>
            </Card>
          )
        })}
      </div>
    </>
  )
}
