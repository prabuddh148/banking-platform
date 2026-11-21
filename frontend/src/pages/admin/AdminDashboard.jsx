import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, Landmark, Receipt, Banknote, ShieldAlert, Timer, ArrowRight, Radio, ShieldCheck, Activity, Workflow } from 'lucide-react'
import { PageHeader, Card, CardHeader, ErrorBanner, EmptyState, Skeleton, ErrorState, Avatar } from '../../components/ui/Primitives.jsx'
import { AreaChart, ColumnChart, Sparkline, Legend, SERIES, compactNumber } from '../../components/ui/Charts.jsx'
import { RefreshButton, DeltaChip, ServiceStatusIcon, serviceStatusMeta, TopicTag, SeverityBadge, RiskScore, RiskLevelBadge, RISK_LEVELS, topicColor } from '../../components/admin/AdminBits.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { getAdminOverview } from '../../services/adminService.js'
import { subscribeToEvents, summarizeEvent } from '../../services/eventService.js'
import { formatCompactCurrency, formatCurrency, formatNumber, formatDate, relativeTime } from '../../lib/format.js'

export default function AdminDashboard() {
  const state = useAsync(() => getAdminOverview(), [])
  const [updatedAt, setUpdatedAt] = useState(null)
  useEffect(() => { if (state.data && !state.loading) setUpdatedAt(new Date()) }, [state.data, state.loading])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations console"
        title="Platform overview"
        subtitle={updatedAt ? `Live view of six microservices, four Kafka topics and the fraud engine · updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Live view of six microservices, four Kafka topics and the fraud engine.'}
        action={
          <>
            <Link to="/admin/events" className="btn-ghost"><Radio size={15} /> Event stream</Link>
            <RefreshButton loading={state.loading} onClick={state.reload} />
          </>
        }
      />
      {state.error ? (
        <Card><ErrorState error={state.error} onRetry={state.reload} title="Couldn't load the dashboard" /></Card>
      ) : state.data === undefined ? (
        <DashboardSkeleton />
      ) : (
        <Overview data={state.data} />
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading dashboard">
      <Skeleton className="h-14 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  )
}

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  return s < 60 ? `${s}s ago` : relativeTime(iso)
}

const hourLabels = () => Array.from({ length: 24 }, (_, i) => {
  const d = new Date(Date.now() - (23 - i) * 3600000)
  return `${String(d.getHours()).padStart(2, '0')}:00`
})

function Overview({ data }) {
  const { kpis, currency, hourly, daily, risk, services, topics, openAlerts, sampleNote, errors } = data
  const labels = useMemo(hourLabels, [])

  const tiles = [
    { key: 'customers', label: 'Customers', icon: Users, tone: 'brand', fmt: formatNumber },
    { key: 'accounts', label: 'Accounts', icon: Landmark, tone: 'slate', fmt: formatNumber },
    { key: 'transactions24h', label: 'Transactions · 24h', icon: Receipt, tone: 'blue', fmt: formatNumber },
    { key: 'volume24h', label: 'Volume · 24h', icon: Banknote, tone: 'green', fmt: (v) => formatCompactCurrency(v, currency) },
    { key: 'openFraud', label: 'Open fraud alerts', icon: ShieldAlert, tone: 'red', fmt: formatNumber, invert: true, href: '/admin/fraud' },
    { key: 'p95LatencyMs', label: 'p95 latency', icon: Timer, tone: 'amber', fmt: (v) => (v == null ? '—' : `${v} ms`), invert: true, href: '/admin/services' },
  ]

  const hourlySeries = [{ name: 'Today', values: hourly.today }]
  if (hourly.yesterday) hourlySeries.push({ name: 'Yesterday', values: hourly.yesterday })
  const total24 = hourly.today.reduce((s, v) => s + v, 0)
  const peak = Math.max(...hourly.today)
  const dayLabels = daily.map((d) => formatDate(d.date, { day: 'numeric', month: 'short' }))
  const failedTotal = daily.reduce((s, d) => s + d.failed, 0)
  const doneTotal = daily.reduce((s, d) => s + d.completed, 0)

  return (
    <>
      {errors.length > 0 && (
        <ErrorBanner>
          <p className="font-medium">Some panels could not be loaded:</p>
          <ul className="mt-1 list-disc pl-4 text-xs">{errors.map((e) => <li key={e.label}>{e.label}: {e.message}</li>)}</ul>
        </ErrorBanner>
      )}

      <ServiceStrip services={services} />

      <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3">
        {tiles.map((t) => <KpiTile key={t.key} tile={t} kpi={kpis[t.key] || {}} />)}
      </div>
      {sampleNote && <p className="-mt-3 text-xs text-slate-400">{sampleNote}.</p>}

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Transactions per hour"
            subtitle="Last 24 hours, all channels"
            action={<div className="text-right"><p className="heading tabular text-xl font-bold">{formatNumber(total24)}</p><p className="muted text-[11px]">peak {formatNumber(peak)}/h</p></div>}
          />
          <div className="px-5 pb-5 pt-4">
            {total24 === 0 ? <EmptyState icon={Receipt} title="No transactions in the last 24h" /> : <AreaChart series={hourlySeries} labels={labels} height={240} format={formatNumber} />}
          </div>
        </Card>
        <RiskCard risk={risk} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Daily outcomes"
            subtitle="Completed vs failed transactions, last 14 days"
            action={<div className="text-right"><p className="heading tabular text-xl font-bold">{doneTotal + failedTotal ? ((failedTotal / (doneTotal + failedTotal)) * 100).toFixed(2) : '0.00'}%</p><p className="muted text-[11px]">failure rate</p></div>}
          />
          <div className="space-y-4 px-5 pb-5 pt-4">
            <Legend items={[{ name: 'Completed', color: SERIES[0] }, { name: 'Failed', color: SERIES[1] }]} />
            <ColumnChart series={[{ name: 'Completed', values: daily.map((d) => d.completed) }]} labels={dayLabels} height={200} format={formatNumber} showLegend={false} />
            <div>
              <p className="muted mb-1 text-[11px] font-medium">Failed (own scale)</p>
              <ColumnChart series={[{ name: 'Failed', values: daily.map((d) => d.failed), color: SERIES[1] }]} labels={dayLabels} height={90} format={formatNumber} showLegend={false} />
            </div>
          </div>
        </Card>
        <LiveFeed />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-5">
        <TopicsCard topics={topics} />
        <AlertsCard alerts={openAlerts} />
      </div>
    </>
  )
}

function KpiTile({ tile, kpi }) {
  const Icon = tile.icon
  const tones = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300',
    slate: 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300',
    blue: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    red: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  }
  const delta = kpi.delta
  const good = delta == null ? null : tile.invert ? delta <= 0 : delta >= 0
  const body = (
    <Card className={`flex h-full flex-col p-4 sm:p-5 ${tile.href ? 'card-hover' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="muted text-sm font-medium">{tile.label}</p>
          <p className="heading tabular mt-1.5 truncate text-xl font-bold leading-tight sm:text-[26px] tracking-tight">{kpi.value == null ? '—' : tile.fmt(kpi.value)}</p>
        </div>
        <div className={`hidden h-10 w-10 shrink-0 place-items-center rounded-xl sm:grid ${tones[tile.tone]}`}><Icon size={19} /></div>
      </div>
      <div className="mt-2 flex min-h-[22px] items-center gap-2">
        {delta != null && <DeltaChip value={delta} good={good} suffix={kpi.absolute ? '' : '%'} />}
        <span className="muted truncate text-xs">{delta != null ? kpi.deltaLabel : kpi.hint || (kpi.spark ? 'last 24h' : 'current')}</span>
      </div>
      <div className="mt-auto pt-3">
        {kpi.spark ? <Sparkline data={kpi.spark} height={36} color={SERIES[0]} /> : <div className="h-9 rounded-lg bg-[repeating-linear-gradient(90deg,var(--chart-grid)_0_1px,transparent_1px_12px)] opacity-60" aria-hidden />}
      </div>
    </Card>
  )
  return tile.href ? <Link to={tile.href} className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{body}</Link> : body
}

function ServiceStrip({ services }) {
  if (!services.length) return null
  const healthy = services.filter((s) => s.status === 'Operational').length
  const all = healthy === services.length
  return (
    <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-3.5">
      <Link to="/admin/services" className="flex shrink-0 items-center gap-2.5 rounded-xl px-2 py-1">
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${all ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300'}`}><Activity size={16} /></span>
        <span>
          <span className="heading block text-sm font-semibold">{all ? 'All systems operational' : 'Partial degradation'}</span>
          <span className="muted block text-xs tabular">{healthy}/{services.length} services healthy</span>
        </span>
      </Link>
      <div className="flex flex-1 flex-wrap gap-2 sm:justify-end">
        {services.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50/60 px-2 py-1 text-xs dark:border-white/[0.07] dark:bg-white/[0.02]" title={`${s.name}: ${serviceStatusMeta(s.status).label}`}>
            <ServiceStatusIcon status={s.status} size={13} />
            <span className="font-mono text-slate-700 dark:text-slate-200">{s.name.replace('-service', '')}</span>
            {s.latencyMs != null && <span className="tabular text-slate-400">{s.latencyMs}ms</span>}
          </span>
        ))}
      </div>
    </Card>
  )
}

function RiskCard({ risk }) {
  const decisions = risk?.decisions
  const total = decisions ? RISK_LEVELS.reduce((s, l) => s + (decisions[l.id] || 0), 0) : 0
  return (
    <Card className="flex flex-col">
      <CardHeader title="Risk distribution" subtitle="Fraud decisions by risk level" action={<Link to="/admin/fraud" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">Review</Link>} />
      {!decisions || total === 0 ? (
        <EmptyState icon={ShieldCheck} title="No decisions yet" message="fraud-service has not scored any transaction." />
      ) : (
        <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]" role="img" aria-label="Share of decisions by risk level">
            {RISK_LEVELS.map((l) => {
              const share = (decisions[l.id] || 0) / total
              return share > 0 && <span key={l.id} style={{ width: `${Math.max(share * 100, 1.2)}%`, background: l.color }} className="border-r-2 border-white last:border-r-0 dark:border-ink-900" />
            })}
          </div>
          <p className="heading tabular mt-3 text-2xl font-bold">{formatNumber(total)} <span className="muted text-sm font-medium">decisions</span></p>
          <ul className="mt-3 flex-1 divide-y divide-slate-100 dark:divide-white/[0.06]">
            {RISK_LEVELS.map((l) => {
              const n = decisions[l.id] || 0
              return (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <RiskLevelBadge level={l.id} />
                    <span className="muted truncate text-xs">{l.decision}</span>
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="heading tabular font-semibold">{formatNumber(n)}</span>
                    <span className="muted tabular w-12 text-right text-xs">{((n / total) * 100).toFixed(n / total < 0.01 ? 2 : 1)}%</span>
                  </span>
                </li>
              )
            })}
          </ul>
          {risk.alerts && (
            <p className="muted mt-2 text-xs">Alerts in queue: <span className="tabular font-semibold text-slate-700 dark:text-slate-200">{risk.alerts.HIGH} HIGH</span> · <span className="tabular font-semibold text-slate-700 dark:text-slate-200">{risk.alerts.CRITICAL} CRITICAL</span></p>
          )}
        </div>
      )}
    </Card>
  )
}

function LiveFeed() {
  const [events, setEvents] = useState([])
  const [error, setError] = useState(null)
  useEffect(() => {
    const stop = subscribeToEvents(
      (incoming) => {
        setError(null)
        setEvents((list) => {
          const ids = new Set(list.map((e) => e.eventId))
          return [...incoming.filter((e) => !ids.has(e.eventId)), ...list].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).slice(0, 8)
        })
      },
      { backfill: 8, onError: setError },
    )
    return stop
  }, [])

  return (
    <Card className="flex flex-col">
      <CardHeader
        icon={Workflow}
        title="Recent events"
        subtitle="Live from Kafka topics"
        action={<Link to="/admin/events" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">Open <ArrowRight size={12} /></Link>}
      />
      <div className="flex-1 px-3 pb-3 pt-3">
        {error && events.length === 0 ? (
          <p className="muted px-2 py-6 text-center text-sm">Event feed unavailable: {error.message}</p>
        ) : events.length === 0 ? (
          <div className="space-y-2 px-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <ul className="space-y-0.5">
            {events.map((e) => (
              <li key={e.eventId} className="animate-fade-in">
                <Link to={e.correlationId ? `/admin/events?correlation=${e.correlationId}` : '/admin/events'} className="flex items-start gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04]">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: topicColor(e.topic) }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">{e.eventType}</span>
                      {e.severity !== 'INFO' && <SeverityBadge severity={e.severity} compact />}
                      <span className="ml-auto shrink-0 text-[10px] text-slate-400">{ago(e.occurredAt)}</span>
                    </span>
                    <span className="muted block truncate text-xs">{e.summary || summarizeEvent(e.eventType, e.payload)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function TopicsCard({ topics }) {
  return (
    <Card className="overflow-hidden lg:col-span-3">
      <CardHeader title="Kafka topics" subtitle="3 partitions each · DLT after 3 retries" action={<Link to="/admin/events" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">Inspect</Link>} />
      <div className="mt-3 overflow-x-auto scrollbar-thin">
        <table className="table-base min-w-[520px]">
          <thead>
            <tr>
              <th>Topic</th>
              <th className="text-right">Throughput</th>
              <th className="w-24">Trend</th>
              <th className="text-right">Lag</th>
              <th className="text-right">DLT</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((t) => {
              const lagState = t.lag == null ? null : t.lag > 100 ? { label: 'Catching up', cls: 'text-amber-700 dark:text-amber-300' } : { label: 'Healthy', cls: 'text-emerald-700 dark:text-emerald-300' }
              return (
                <tr key={t.topic}>
                  <td>
                    <TopicTag topic={t.topic} full />
                    <p className="muted ml-3.5 text-[11px]">{[t.producer, `${t.partitions} partitions`].filter(Boolean).join(" · ")}</p>
                  </td>
                                    <td className="tabular text-right font-semibold text-slate-900 dark:text-white">{t.throughput == null ? '—' : <>{compactNumber(t.throughput)}<span className="muted ml-0.5 text-[11px] font-normal">/s</span></>}</td>
                  <td>{t.spark ? <Sparkline data={t.spark} height={24} color={topicColor(t.topic)} fill={false} /> : <span className="muted text-xs">—</span>}</td>
                  <td className="text-right">
                    {t.lag == null ? <span className="muted">—</span> : (
                      <span className="inline-flex flex-col items-end">
                        <span className="tabular font-semibold text-slate-900 dark:text-white">{formatNumber(t.lag)}</span>
                        <span className={`text-[11px] font-medium ${lagState.cls}`}>{lagState.label}</span>
                      </span>
                    )}
                  </td>
                  <td className="tabular text-right text-slate-700 dark:text-slate-200">{t.dlt ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {topics.every((t) => t.throughput == null) && <p className="muted px-5 pb-4 text-xs">Broker metrics are not exposed through the gateway; see the event stream for live traffic.</p>}
    </Card>
  )
}

function AlertsCard({ alerts }) {
  const sorted = [...alerts].sort((a, b) => b.riskScore - a.riskScore)
  return (
    <Card className="flex flex-col lg:col-span-2">
      <CardHeader icon={ShieldAlert} title="Fraud review queue" subtitle={`${alerts.length} open alert${alerts.length === 1 ? '' : 's'}`} action={<Link to="/admin/fraud" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">View all</Link>} />
      {sorted.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Queue is clear" message="No transactions are waiting for review." />
      ) : (
        <ul className="mt-2 flex-1 divide-y divide-slate-100 px-2 pb-2 dark:divide-white/[0.05]">
          {sorted.slice(0, 5).map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-3">
              <Avatar name={a.customer} size={32} />
              <div className="min-w-0 flex-1">
                <p className="heading truncate text-sm font-medium">{a.customer} <span className="muted tabular font-normal">· {formatCurrency(a.amount, a.currency)}</span></p>
                <p className="muted truncate text-xs">{a.reason}</p>
              </div>
              <RiskScore score={a.riskScore} size={34} />
              <Link to={`/admin/fraud?alert=${a.id}`} className="btn-ghost shrink-0 px-2.5 py-1 text-xs">Review</Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

