import { useEffect, useRef, useState } from 'react'
import { Activity, Boxes, Timer, Gauge, RefreshCw, Server, Pause, Play } from 'lucide-react'
import { PageHeader, Card, CardHeader, EmptyState, ErrorState, Skeleton, Spinner, Badge } from '../../components/ui/Primitives.jsx'
import { Sparkline } from '../../components/ui/Charts.jsx'
import { ServiceStatusIcon, serviceStatusMeta } from '../../components/admin/AdminBits.jsx'
import { useInterval } from '../../components/admin/hooks.js'
import { useAsync } from '../../lib/useAsync.js'
import { getSystemHealth } from '../../services/systemService.js'
import { formatTime } from '../../lib/format.js'

const REFRESH_S = 10

export default function ServiceHealth() {
  const state = useAsync(() => getSystemHealth(), [])
  const [auto, setAuto] = useState(true)
  const [left, setLeft] = useState(REFRESH_S)
  const history = useRef(new Map()) // service -> latency samples (accumulated across polls)
  const [, force] = useState(0)

  // Merge each poll into the latency history
  useEffect(() => {
    if (!state.data) return
    state.data.services.forEach((s) => {
      if (s.history?.length) history.current.set(s.name, s.history.slice(-30))
      else if (s.latencyMs != null) {
        const h = history.current.get(s.name) || []
        history.current.set(s.name, [...h, s.latencyMs].slice(-30))
      }
    })
    force((n) => n + 1)
  }, [state.data])

  useInterval(() => {
    if (state.loading) return
    if (left <= 1) {
      setLeft(REFRESH_S)
      state.reload()
    } else setLeft(left - 1)
  }, 1000, auto)

  function refreshNow() {
    setLeft(REFRESH_S)
    state.reload()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="api-gateway · /system/health"
        title="Service health"
        subtitle="The gateway calls every service's /actuator/health in parallel (2 s timeout)."
        action={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAuto((a) => !a)} aria-pressed={auto}>
              {auto ? <Pause size={15} /> : <Play size={15} />} {auto ? 'Pause auto-refresh' : 'Auto-refresh'}
            </button>
            <button type="button" className="btn-primary" onClick={refreshNow} disabled={state.loading}>
              {state.loading ? <Spinner size={15} /> : <RefreshCw size={15} />} Refresh
            </button>
          </>
        }
      />
      {state.error && !state.data ? (
        <Card><ErrorState error={state.error} onRetry={refreshNow} title="Couldn't reach the health endpoint" /></Card>
      ) : !state.data ? (
        <div className="space-y-6">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}</div>
        </div>
      ) : (
        <Health health={state.data} history={history.current} auto={auto} left={left} loading={state.loading} error={state.error} />
      )}
    </div>
  )
}

function Health({ health, history, auto, left, loading, error }) {
  const services = health.services
  if (services.length === 0) {
    return <Card><EmptyState icon={Activity} title="No services reported" message="The gateway returned no downstream health data." /></Card>
  }
  const up = services.filter((s) => s.status === 'Operational').length
  const down = services.filter((s) => s.status === 'Down')
  const degraded = services.filter((s) => s.status !== 'Operational' && s.status !== 'Down')
  const lat = services.filter((s) => s.latencyMs != null)
  const avg = lat.length ? Math.round(lat.reduce((s, x) => s + x.latencyMs, 0) / lat.length) : null
  const inst = services.filter((s) => s.instances != null).reduce((s, x) => s + x.instances, 0)
  const upt = services.filter((s) => s.uptime != null)
  const avgUptime = upt.length ? (upt.reduce((s, x) => s + x.uptime, 0) / upt.length).toFixed(2) : null
  const overall = down.length ? 'Down' : degraded.length ? 'Degraded' : 'Operational'
  const banner = {
    Operational: { title: 'All systems operational', cls: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-400/20 dark:bg-emerald-500/[0.08]' },
    Degraded: { title: `Degraded performance · ${degraded.map((s) => s.name).join(', ')}`, cls: 'border-amber-200 bg-amber-50/70 dark:border-amber-400/20 dark:bg-amber-500/[0.08]' },
    Down: { title: `Outage · ${down.map((s) => s.name).join(', ')}`, cls: 'border-rose-200 bg-rose-50/70 dark:border-rose-400/20 dark:bg-rose-500/[0.08]' },
  }[overall]

  return (
    <>
      <div className={`flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center ${banner.cls}`}>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white shadow-soft dark:bg-ink-900"><ServiceStatusIcon status={overall} size={24} /></div>
        <div className="min-w-0 flex-1">
          <p className="heading text-lg font-semibold">{banner.title}</p>
          <p className="muted text-sm">{up} of {services.length} services healthy · last check {formatTime(health.checkedAt)}{error ? ' · last refresh failed, showing previous result' : ''}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
          {auto ? (
            <>
              <svg width="28" height="28" viewBox="0 0 28 28" className="-rotate-90" aria-hidden>
                <circle cx="14" cy="14" r="11" fill="none" stroke="var(--chart-grid)" strokeWidth="3" />
                <circle cx="14" cy="14" r="11" fill="none" stroke="var(--series-1)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(left / REFRESH_S) * 69.1} 69.1`} className="transition-all duration-1000 ease-linear" />
              </svg>
              <span className="tabular">{loading ? 'Refreshing…' : `Next check in ${left}s`}</span>
            </>
          ) : <span>Auto-refresh paused</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
        <Mini icon={Activity} label="Services up" value={`${up}/${services.length}`} />
        <Mini icon={Timer} label="Avg probe latency" value={avg != null ? `${avg} ms` : '—'} />
        <Mini icon={Boxes} label="Instances" value={inst || '—'} />
        <Mini icon={Gauge} label="Avg uptime (30d)" value={avgUptime ? `${avgUptime}%` : '—'} />
      </div>

      <Topology services={services} />

      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
        {services.map((s) => <ServiceCard key={s.name} service={s} history={history.get(s.name) || []} />)}
      </div>
    </>
  )
}

function Mini({ icon: Icon, label, value }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between"><p className="muted text-xs font-medium">{label}</p><Icon size={16} className="text-slate-400" /></div>
      <p className="heading tabular mt-1 text-2xl font-bold">{value}</p>
    </Card>
  )
}

function ServiceCard({ service: s, history }) {
  const m = serviceStatusMeta(s.status)
  const slow = s.latencyMs != null && s.latencyMs > 200
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300"><Server size={17} /></div>
          <div className="min-w-0">
            <h3 className="heading truncate font-mono text-sm font-semibold">{s.name}</h3>
            <p className="muted text-[11px]">{[s.port && `:${s.port}`, s.version && `v${s.version}`].filter(Boolean).join(' · ') || '—'}</p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-white/[0.06] dark:text-slate-200">
          <ServiceStatusIcon status={s.status} size={13} /> {m.label}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="muted text-[11px]">Probe latency</p>
          <p className="heading tabular text-xl font-bold">{s.latencyMs != null ? `${s.latencyMs} ms` : '—'}{slow && <Badge tone="amber" className="ml-2 align-middle">slow</Badge>}</p>
        </div>
        <div className="w-1/2">
          {history.length >= 2 ? <Sparkline data={history} height={36} color={slow ? 'var(--series-2)' : 'var(--series-1)'} /> : <p className="muted text-right text-[11px]">collecting samples…</p>}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['Uptime', s.uptime != null ? `${s.uptime}%` : '—'],
          ['Instances', s.instances ?? '—'],
          ['Port', s.port ?? '—'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-slate-50 py-2 dark:bg-white/[0.03]">
            <dt className="muted text-[11px]">{k}</dt>
            <dd className="heading tabular text-sm font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {s.error && <p className="mt-3 break-words text-xs text-rose-600 dark:text-rose-300">{s.error}</p>}
    </Card>
  )
}

/* ------------------------------------------------------------------ topology */

const W = 1000
const H = 360
const NODE_W = 196
const NODE_H = 46

function Topology({ services }) {
  const byName = new Map(services.map((s) => [s.name, s]))
  const downstream = ['account-service', 'transaction-service', 'fraud-service', 'notification-service', 'audit-service']
  const gw = byName.get('api-gateway') || { name: 'api-gateway', status: services.every((s) => s.status === 'Operational') ? 'Operational' : 'Degraded' }
  const svcY = (i) => 24 + i * ((H - 48 - NODE_H) / (downstream.length - 1))
  const nodes = {
    client: { x: 16, y: H / 2 - NODE_H / 2, label: 'React SPA', sub: 'JWT · REST', status: 'Operational' },
    gateway: { x: 246, y: H / 2 - NODE_H / 2, label: 'api-gateway', sub: ':8080 · JWT · breakers', status: gw.status },
    ...Object.fromEntries(downstream.map((n, i) => [n, { x: 480, y: svcY(i), label: n, sub: byName.get(n)?.latencyMs != null ? `${byName.get(n).latencyMs} ms` : 'no data', status: byName.get(n)?.status || 'Unknown' }])),
  }
  const dbDown = downstream.some((n) => byName.get(n)?.status === 'Down')
  nodes.postgres = { x: W - NODE_W - 16, y: 60, label: 'PostgreSQL', sub: '5 DBs · one per service', status: dbDown ? 'Degraded' : 'Operational' }
  nodes.kafka = { x: W - NODE_W - 16, y: H - 60 - NODE_H, label: 'Kafka', sub: '4 topics · 3 partitions', status: 'Operational' }

  const edge = (a, b, kind) => {
    const A = nodes[a]
    const B = nodes[b]
    const x1 = A.x + NODE_W
    const y1 = A.y + NODE_H / 2
    const x2 = B.x
    const y2 = B.y + NODE_H / 2
    const mx = (x1 + x2) / 2
    return { id: `${a}-${b}`, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, kind, ok: A.status === 'Operational' && B.status === 'Operational' }
  }
  const edges = [
    edge('client', 'gateway', 'http'),
    ...downstream.map((n) => edge('gateway', n, 'http')),
    ...downstream.map((n) => edge(n, 'postgres', 'db')),
    ...downstream.map((n) => edge(n, 'kafka', 'kafka')),
  ]

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Topology"
        subtitle="Request path and dependencies, colored by health"
        action={
          <ul className="hidden flex-wrap items-center gap-3 text-[11px] text-slate-500 sm:flex dark:text-slate-400">
            <li className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--series-1)]" /> HTTP</li>
            <li className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--series-3)]" /> Postgres</li>
            <li className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--series-7)]" /> Kafka</li>
          </ul>
        }
      />
      <div className="overflow-x-auto px-3 pb-4 pt-2 scrollbar-thin">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[720px]" role="img" aria-label="Service topology">
          {edges.map((e) => (
            <path
              key={e.id}
              d={e.d}
              fill="none"
              stroke={e.ok ? (e.kind === 'http' ? 'var(--series-1)' : e.kind === 'db' ? 'var(--series-3)' : 'var(--series-7)') : 'var(--status-warning)'}
              strokeWidth={e.kind === 'http' ? 1.8 : 1.2}
              strokeOpacity={e.kind === 'http' ? 0.85 : 0.45}
              strokeDasharray={e.ok ? '4 8' : '2 4'}
              className={e.kind === 'http' ? 'animate-flow' : ''}
            />
          ))}
          {Object.entries(nodes).map(([id, n]) => {
            const m = serviceStatusMeta(n.status)
            return (
              <g key={id} transform={`translate(${n.x},${n.y})`}>
                <title>{`${n.label}: ${m.label}`}</title>
                <rect width={NODE_W} height={NODE_H} rx="12" className="fill-white dark:fill-[#161a25]" stroke={m.color} strokeWidth="1.5" />
                <circle cx="16" cy={NODE_H / 2} r="5" fill={m.color} />
                <text x="30" y="20" className="fill-slate-800 font-mono text-[12px] font-semibold dark:fill-slate-100">{n.label}</text>
                <text x="30" y="35" className="fill-slate-500 text-[10.5px] dark:fill-slate-400">{n.status !== 'Operational' ? `${m.label} · ${n.sub}` : n.sub}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </Card>
  )
}
