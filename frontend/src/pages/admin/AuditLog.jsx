import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ScrollText, ChevronRight, Download, GitBranch, Lock, Filter } from 'lucide-react'
import { PageHeader, Card, SearchInput, Segmented, EmptyState, ErrorState, LoadingState, Pagination, CopyButton } from '../../components/ui/Primitives.jsx'
import { SeverityBadge, TopicTag, RefreshButton } from '../../components/admin/AdminBits.jsx'
import { usePaged } from '../../components/admin/hooks.js'
import { downloadCsv, stamp } from '../../components/admin/csv.js'
import { useAsync } from '../../lib/useAsync.js'
import { listAuditLogs } from '../../services/auditService.js'
import { EVENT_TYPE_NAMES, SERVICE_NAMES, topicOf } from '../../services/eventCatalog.js'
import { formatDate, formatNumber } from '../../lib/format.js'
import { shortId } from '../../services/mappers.js'

const RANGES = [
  { value: '1h', label: '1h', ms: 3600e3 },
  { value: '24h', label: '24h', ms: 24 * 3600e3 },
  { value: '7d', label: '7d', ms: 7 * 24 * 3600e3 },
  { value: 'all', label: 'All', ms: null },
]
const PAGE_SIZE = 15

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const time = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

export default function AuditLog() {
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') || '')
  const [actor, setActor] = useState('')
  const [eventType, setEventType] = useState('')
  const [service, setService] = useState('')
  const [severity, setSeverity] = useState('all')
  const [range, setRange] = useState(params.get('q') ? 'all' : '24h')
  const debouncedActor = useDebounced(actor)

  // Server-side filters (audit-service query params); search + service are applied client-side
  const from = useMemo(() => {
    const r = RANGES.find((x) => x.value === range)
    return r?.ms ? new Date(Date.now() - r.ms).toISOString() : undefined
  }, [range])
  const state = useAsync(
    () => listAuditLogs({ eventType: eventType || undefined, actor: debouncedActor || undefined, from, size: 200 }),
    [eventType, debouncedActor, from],
  )

  const logs = state.data || []
  const base = useMemo(() => {
    const q = query.trim().toLowerCase()
    return logs.filter((l) => {
      if (service && l.service !== service) return false
      if (q && ![l.action, l.entity, l.actor, l.detail, l.correlationId, l.eventId].some((s) => String(s || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [logs, query, service])
  const counts = useMemo(() => ({
    all: base.length,
    INFO: base.filter((l) => l.severity === 'INFO').length,
    WARNING: base.filter((l) => l.severity === 'WARNING').length,
    CRITICAL: base.filter((l) => l.severity === 'CRITICAL').length,
  }), [base])
  const rows = severity === 'all' ? base : base.filter((l) => l.severity === severity)
  const filterKey = [query, service, severity, eventType, debouncedActor, range].join('|')
  const { page, setPage, pageCount, pageRows } = usePaged(rows, PAGE_SIZE, filterKey)
  const filtered = Boolean(query || actor || eventType || service || severity !== 'all' || range !== '24h')

  function exportCsv() {
    downloadCsv(`audit-log-${stamp()}.csv`, [
      { header: 'occurredAt', value: (r) => r.timestamp },
      { header: 'eventType', value: (r) => r.action },
      { header: 'severity', value: (r) => r.severity },
      { header: 'sourceService', value: (r) => r.service },
      { header: 'actor', value: (r) => r.actor },
      { header: 'aggregateType', value: (r) => r.entityType },
      { header: 'aggregateId', value: (r) => r.entity },
      { header: 'correlationId', value: (r) => r.correlationId },
      { header: 'eventId', value: (r) => r.eventId },
      { header: 'action', value: (r) => r.detail },
      { header: 'details', value: (r) => r.details },
    ], rows)
  }

  function reset() {
    setQuery(''); setActor(''); setEventType(''); setService(''); setSeverity('all'); setRange('24h')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="audit-service"
        title="Audit log"
        subtitle="Every Kafka event, recorded once and immutable: database triggers reject UPDATE and DELETE."
        action={
          <>
            <button type="button" className="btn-ghost" onClick={exportCsv} disabled={!rows.length}><Download size={15} /> Export CSV</button>
            <RefreshButton loading={state.loading} onClick={state.reload} />
          </>
        }
      />

      <Card className="space-y-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <SearchInput className="flex-1" value={query} onChange={setQuery} placeholder="Search event, aggregate, correlation or event ID…" />
          <label className="sr-only" htmlFor="audit-actor">Actor</label>
          <input id="audit-actor" className="input lg:w-48" placeholder="Actor (e.g. ADMIN-1)" value={actor} onChange={(e) => setActor(e.target.value)} />
          <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="sr-only" htmlFor="audit-type">Event type</label>
          <select id="audit-type" className="input md:w-60" value={eventType} onChange={(e) => setEventType(e.target.value)}>
            <option value="">All event types</option>
            {EVENT_TYPE_NAMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="sr-only" htmlFor="audit-service">Service</label>
          <select id="audit-service" className="input md:w-56" value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">All services</option>
            {SERVICE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="md:ml-auto">
            <Segmented size="sm" value={severity} onChange={setSeverity} options={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'INFO', label: 'Info', count: counts.INFO },
              { value: 'WARNING', label: 'Warning', count: counts.WARNING },
              { value: 'CRITICAL', label: 'Critical', count: counts.CRITICAL },
            ]} />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-xs dark:border-white/[0.06]">
          <span className="muted inline-flex items-center gap-1.5"><Lock size={12} /> {formatNumber(rows.length)} event{rows.length === 1 ? '' : 's'} · newest first · PII masked</span>
          {filtered && <button type="button" onClick={reset} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-300"><Filter size={12} /> Clear filters</button>}
        </div>
        {state.error ? (
          <ErrorState error={state.error} onRetry={state.reload} title="Couldn't load the audit log" />
        ) : state.data === undefined ? (
          <LoadingState rows={8} label="Loading audit events…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={logs.length === 0 ? 'No audit events in this range' : 'No events match'}
            message={logs.length === 0 ? 'Events from account, transaction and fraud services appear here as they happen.' : 'Try widening the time range or clearing filters.'}
            action={filtered && <button type="button" className="btn-ghost" onClick={reset}>Clear filters</button>}
          />
        ) : (
          <>
            <div className={`hidden overflow-x-auto scrollbar-thin transition-opacity md:block ${state.loading ? 'opacity-60' : ''}`}>
              <table className="table-base min-w-[860px]">
                <thead>
                  <tr>
                    <th className="w-8" aria-label="Expand" />
                    <th>Time</th>
                    <th>Event</th>
                    <th>Severity</th>
                    <th>Service</th>
                    <th>Actor</th>
                    <th>Aggregate</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((l) => <AuditRow key={l.id} log={l} />)}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-white/[0.05]">
              {pageRows.map((l) => <AuditItem key={l.id} log={l} />)}
            </ul>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} total={rows.length} pageSize={PAGE_SIZE} />
          </>
        )}
      </Card>
    </div>
  )
}

function AuditRow({ log: l }) {
  const [open, setOpen] = useState(false)
  return (
    <Fragment>
      <tr className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="pr-0">
          <button type="button" className="btn-icon h-6 w-6" aria-expanded={open} aria-label={open ? 'Collapse row' : 'Expand row'} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>
            <ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        </td>
        <td className="whitespace-nowrap">
          <p className="tabular font-mono text-xs text-slate-700 dark:text-slate-200">{time(l.timestamp)}</p>
          <p className="text-[11px] text-slate-400">{formatDate(l.timestamp, { day: 'numeric', month: 'short' })}</p>
        </td>
        <td className="max-w-[360px]">
          <p className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{l.action}</p>
          <p className="muted truncate text-xs">{l.detail}</p>
        </td>
        <td><SeverityBadge severity={l.severity} /></td>
        <td className="whitespace-nowrap font-mono text-xs text-slate-600 dark:text-slate-300">{l.service}</td>
        <td className="whitespace-nowrap font-mono text-xs text-slate-600 dark:text-slate-300">{l.actor}</td>
        <td className="whitespace-nowrap">
          <p className="font-mono text-xs text-slate-700 dark:text-slate-200" title={l.entity}>{shortId(l.entity)}</p>
          {l.entityType && <p className="text-[11px] text-slate-400">{l.entityType}</p>}
        </td>
      </tr>
      {open && (
        <tr className="!border-t-0 bg-slate-50/70 hover:!bg-slate-50/70 dark:bg-white/[0.02] dark:hover:!bg-white/[0.02]">
          <td />
          <td colSpan={6} className="pb-4 pt-1">
            <AuditDetail log={l} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function AuditDetail({ log: l }) {
  const details = l.details && typeof l.details === 'object' ? Object.entries(l.details) : []
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
      <div>
        <p className="text-sm text-slate-700 dark:text-slate-200">{l.detail}</p>
        {details.length > 0 && (
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {details.map(([k, v]) => (
              <div key={k} className="flex min-w-0 items-baseline gap-2 text-xs">
                <dt className="shrink-0 font-mono text-slate-400">{k}</dt>
                <dd className="truncate font-mono text-slate-700 dark:text-slate-200" title={typeof v === 'object' ? JSON.stringify(v) : String(v)}>{v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-white/10 dark:bg-ink-850">
        <div className="flex items-center justify-between gap-2"><span className="muted">Topic</span><TopicTag topic={topicOf(l.action)} /></div>
        {l.eventId && <div className="flex items-center justify-between gap-2"><span className="muted">Event ID</span><span className="flex min-w-0 items-center font-mono"><span className="truncate">{shortId(l.eventId)}</span><CopyButton value={l.eventId} label="Copy event ID" /></span></div>}
        <div className="flex items-center justify-between gap-2"><span className="muted">Aggregate</span><span className="flex min-w-0 items-center font-mono"><span className="truncate">{shortId(l.entity)}</span><CopyButton value={l.entity} label="Copy aggregate ID" /></span></div>
        <div className="flex items-center justify-between gap-2"><span className="muted">Correlation</span><span className="flex min-w-0 items-center font-mono"><span className="truncate">{shortId(l.correlationId)}</span>{l.correlationId && <CopyButton value={l.correlationId} label="Copy correlation ID" />}</span></div>
        {l.correlationId && (
          <Link to={`/admin/events?correlation=${encodeURIComponent(l.correlationId)}`} className="btn-ghost mt-1 w-full py-1.5 text-xs">
            <GitBranch size={13} /> View correlated events
          </Link>
        )}
      </div>
    </div>
  )
}

function AuditItem({ log: l }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03]">
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{l.action}</span>
            <SeverityBadge severity={l.severity} compact={l.severity === 'INFO'} />
          </span>
          <span className="muted mt-0.5 block truncate text-xs">{l.detail}</span>
          <span className="mt-1 block font-mono text-[11px] text-slate-400">{time(l.timestamp)} · {l.service} · {l.actor}</span>
        </span>
        <ChevronRight size={15} className={`mt-0.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="bg-slate-50/70 px-4 pb-4 pt-1 dark:bg-white/[0.02]"><AuditDetail log={l} /></div>}
    </li>
  )
}
