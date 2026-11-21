import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pause, Play, Trash2, Radio, GitBranch, X, Braces, Workflow, Gauge, Layers, AlertTriangle, CheckCircle2, CircleDot, XCircle } from 'lucide-react'
import { PageHeader, Card, CardHeader, SearchInput, Segmented, EmptyState, ErrorBanner, Drawer, CopyButton, Skeleton } from '../../components/ui/Primitives.jsx'
import { Sparkline } from '../../components/ui/Charts.jsx'
import { TopicTag, SeverityBadge, JsonView, LiveDot, topicColor } from '../../components/admin/AdminBits.jsx'
import { useInterval, useMediaQuery } from '../../components/admin/hooks.js'
import { subscribeToEvents, getCorrelatedEvents, summarizeEvent, TOPICS, BASE_EVENT_FIELDS, IS_SIMULATED, POLL_INTERVAL_MS } from '../../services/eventService.js'
import { formatNumber } from '../../lib/format.js'
import { shortId } from '../../services/mappers.js'

const MAX_EVENTS = 500

function byNewest(a, b) {
  const d = new Date(b.occurredAt) - new Date(a.occurredAt)
  return d !== 0 ? d : (b.offset ?? 0) - (a.offset ?? 0)
}

function merge(existing, incoming) {
  const map = new Map(existing.map((e) => [e.eventId, e]))
  incoming.forEach((e) => map.set(e.eventId, e))
  return [...map.values()].sort(byNewest).slice(0, MAX_EVENTS)
}

function clock(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n, l = 2) => String(n).padStart(l, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** The message as it sits on the topic: BaseEvent fields first, then the payload (flat JSON). */
function toMessage(e) {
  const base = Object.fromEntries(BASE_EVENT_FIELDS.map((k) => [k, e[k]]))
  return { ...base, ...e.payload }
}

export default function EventStream() {
  const [params, setParams] = useSearchParams()
  const isLg = useMediaQuery('(min-width: 1024px)')
  const [events, setEvents] = useState([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [paused, setPaused] = useState(false)
  const [buffered, setBuffered] = useState(0)
  const [topic, setTopic] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [query, setQuery] = useState(() => params.get('q') || '')
  const [selected, setSelected] = useState(null)
  const [totals, setTotals] = useState(() => Object.fromEntries(TOPICS.map((t) => [t.id, 0])))
  const [eps, setEps] = useState({ now: 0, history: Array(30).fill(0) })
  const correlation = params.get('correlation') || ''

  const pausedRef = useRef(false)
  const pendingRef = useRef([])
  const arrivalsRef = useRef([])

  const seenRef = useRef(new Set())

  const ingest = useCallback((batch) => {
    // count each event once (StrictMode re-subscribes and re-delivers the backfill)
    const incoming = (batch || []).filter((e) => !seenRef.current.has(e.eventId))
    incoming.forEach((e) => seenRef.current.add(e.eventId))
    if (!incoming.length) return
    setReady(true)
    setError(null)
    const now = Date.now()
    incoming.forEach(() => arrivalsRef.current.push(now))
    setTotals((t) => {
      const next = { ...t }
      incoming.forEach((e) => { if (e.topic) next[e.topic] = (next[e.topic] || 0) + 1 })
      return next
    })
    if (pausedRef.current) {
      pendingRef.current.push(...incoming)
      setBuffered(pendingRef.current.length)
      return
    }
    setEvents((list) => merge(list, incoming))
  }, [])

  // Subscribe once; the unsubscribe stops every timer of the generator / poller
  useEffect(() => {
    const stop = subscribeToEvents(ingest, {
      backfill: 60,
      onError: (err) => { setError(err); setReady(true) },
      onStatus: (s) => s === 'live' && setReady(true),
    })
    const t = setTimeout(() => setReady(true), 4000)
    return () => { stop(); clearTimeout(t) }
  }, [ingest])

  // Following a saga: pull its full history too (audit-service has it even if the buffer doesn't)
  useEffect(() => {
    if (!correlation) return undefined
    let active = true
    getCorrelatedEvents(correlation)
      .then((list) => active && list?.length && setEvents((cur) => merge(cur, list)))
      .catch(() => {})
    return () => { active = false }
  }, [correlation])

  // Events/sec over a 5 s window, sampled every second
  useInterval(() => {
    const now = Date.now()
    arrivalsRef.current = arrivalsRef.current.filter((t) => now - t < 30000)
    const rate = arrivalsRef.current.filter((t) => now - t < 5000).length / 5
    setEps((s) => ({ now: rate, history: [...s.history.slice(1), rate] }))
  }, 1000)

  function togglePause() {
    if (paused) {
      const pending = pendingRef.current
      pendingRef.current = []
      setBuffered(0)
      setEvents((list) => merge(list, pending))
    }
    pausedRef.current = !paused
    setPaused(!paused)
  }

  function follow(id) {
    const next = new URLSearchParams(params)
    if (id) next.set('correlation', id)
    else next.delete('correlation')
    setParams(next, { replace: true })
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return events.filter((e) => {
      if (correlation && e.correlationId !== correlation) return false
      if (topic !== 'all' && e.topic !== topic) return false
      if (severity === 'alerts' && e.severity === 'INFO') return false
      if (q) {
        const hay = [e.eventType, e.aggregateId, e.correlationId, e.source, e.key, e.payload?.initiatedBy, e.payload?.reference, e.payload?.customerName].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [events, topic, severity, query, correlation])

  const sagas = useMemo(() => new Set(events.map((e) => e.correlationId).filter(Boolean)).size, [events])
  const alerts = useMemo(() => events.filter((e) => e.severity !== 'INFO').length, [events])
  const totalAll = Object.values(totals).reduce((s, v) => s + v, 0)
  const trail = useMemo(() => (selected?.correlationId ? events.filter((e) => e.correlationId === selected.correlationId).sort((a, b) => -byNewest(a, b)) : []), [events, selected])

  // Desktop: open the inspector on the newest event once data arrives
  useEffect(() => {
    if (isLg && !selected && events.length) setSelected(events[0])
  }, [isLg, selected, events])

  const inspector = <Inspector event={selected} trail={trail} onFollow={follow} following={correlation} onSelect={setSelected} />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Kafka · event-driven core"
        title="Event stream"
        subtitle="Every domain event on the platform's four topics, as it happens. Click one to inspect the message."
        action={
          <>
            <button type="button" className={paused ? 'btn-primary' : 'btn-ghost'} onClick={togglePause} aria-pressed={paused}>
              {paused ? <Play size={15} /> : <Pause size={15} />}
              {paused ? `Resume${buffered ? ` (${buffered} new)` : ''}` : 'Pause'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setEvents([]); setSelected(null) }} aria-label="Clear feed">
              <Trash2 size={15} /> Clear
            </button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="muted text-xs font-medium">Events / sec</p>
            <Gauge size={16} className="text-slate-400" />
          </div>
          <p className="heading tabular mt-1 text-2xl font-bold">{eps.now.toFixed(1)}</p>
          <div className="mt-1"><Sparkline data={eps.history} height={26} /></div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="muted text-xs font-medium">Received</p>
            <Layers size={16} className="text-slate-400" />
          </div>
          <p className="heading tabular mt-1 text-2xl font-bold">{formatNumber(totalAll)}</p>
          <p className="muted mt-2 text-xs">{formatNumber(events.length)} in buffer · max {MAX_EVENTS}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="muted text-xs font-medium">Sagas in view</p>
            <Workflow size={16} className="text-slate-400" />
          </div>
          <p className="heading tabular mt-1 text-2xl font-bold">{formatNumber(sagas)}</p>
          <p className="muted mt-2 text-xs">Distinct correlation IDs</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="muted text-xs font-medium">Warnings &amp; critical</p>
            <AlertTriangle size={16} className="text-slate-400" />
          </div>
          <p className="heading tabular mt-1 text-2xl font-bold">{formatNumber(alerts)}</p>
          <p className="muted mt-2 text-xs">Failures, fraud flags, freezes</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by topic">
            <TopicChip active={topic === 'all'} onClick={() => setTopic('all')} label="All topics" count={totalAll} />
            {TOPICS.map((t) => (
              <TopicChip key={t.id} active={topic === t.id} onClick={() => setTopic(t.id)} label={t.short} color={topicColor(t.id)} count={totals[t.id] || 0} title={t.id} />
            ))}
          </div>
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
            <div className="shrink-0 whitespace-nowrap"><Segmented size="sm" value={severity} onChange={setSeverity} options={[{ value: 'all', label: 'All' }, { value: 'alerts', label: 'Warnings+' }]} /></div>
            <SearchInput className="min-w-0 flex-1 xl:max-w-xs" value={query} onChange={setQuery} placeholder="Type, aggregate, correlation, actor…" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs dark:border-white/[0.06]">
          <LiveDot active={!paused && !error} label={paused ? 'Paused' : IS_SIMULATED ? 'Live · simulated Kafka cluster' : `Live · polling audit-service every ${POLL_INTERVAL_MS / 1000}s`} />
          <span className="muted">4 topics × 3 partitions · key = aggregateId · acks=all</span>
        </div>
      </Card>

      {error && (
        <ErrorBanner error={error}>
          <p className="mt-1 text-xs">Retrying every {POLL_INTERVAL_MS / 1000}s. Events already received stay on screen.</p>
        </ErrorBanner>
      )}

      {correlation && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-400/20 dark:bg-brand-500/10 dark:text-brand-200">
          <GitBranch size={16} />
          <span>Following saga <span className="font-mono text-xs font-semibold">{shortId(correlation)}</span> · {visible.length} event{visible.length === 1 ? '' : 's'}</span>
          <CopyButton value={correlation} label="Copy correlation ID" />
          <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold hover:bg-brand-100 dark:hover:bg-brand-500/20" onClick={() => follow('')}>
            <X size={14} /> Stop following
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[104px_104px_minmax(0,1fr)_190px] gap-3 border-b border-slate-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid dark:border-white/[0.06] dark:text-slate-400">
            <span>Time</span><span>Topic</span><span>Event</span><span className="text-right">Partition · offset</span>
          </div>
          <div className="max-h-[680px] min-h-[420px] overflow-y-auto scrollbar-thin" aria-live="off">
            {!ready && events.length === 0 ? (
              <div className="space-y-3 p-4">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : visible.length === 0 ? (
              <EmptyState
                icon={Radio}
                title={events.length === 0 ? 'Waiting for events' : 'No events match'}
                message={events.length === 0 ? (paused ? 'The stream is paused.' : 'New events will appear here the moment they are published.') : 'Try another topic, severity or search.'}
                action={events.length > 0 && <button type="button" className="btn-ghost" onClick={() => { setTopic('all'); setSeverity('all'); setQuery(''); follow('') }}>Reset filters</button>}
              />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {visible.map((e) => (
                  <EventRow key={e.eventId} event={e} active={selected?.eventId === e.eventId} onClick={() => setSelected(e)} />
                ))}
              </ul>
            )}
          </div>
        </Card>

        {isLg ? (
          <div className="lg:sticky lg:top-4 lg:self-start">{inspector}</div>
        ) : (
          <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.eventType || 'Event'} subtitle={selected ? `${selected.topic} · p${selected.partition ?? '—'}` : ''} width="max-w-lg">
            <Inspector event={selected} trail={trail} onFollow={(id) => { follow(id); setSelected(null) }} following={correlation} onSelect={setSelected} bare />
          </Drawer>
        )}
      </div>
    </div>
  )
}

function TopicChip({ active, onClick, label, count, color, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-400/30 dark:bg-brand-500/15 dark:text-brand-100' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-300 dark:hover:bg-white/[0.06]'}`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      <span className="capitalize">{label}</span>
      <span className="tabular rounded-md bg-slate-100 px-1.5 py-px text-[10px] text-slate-600 dark:bg-white/10 dark:text-slate-300">{formatNumber(count)}</span>
    </button>
  )
}

function EventRow({ event: e, active, onClick }) {
  const summary = e.summary || summarizeEvent(e.eventType, e.payload)
  return (
    <li className="animate-fade-in">
      <button
        type="button"
        onClick={onClick}
        className={`relative grid w-full grid-cols-1 gap-1 px-4 py-2.5 text-left transition-colors md:grid-cols-[104px_104px_minmax(0,1fr)_190px] md:items-center md:gap-3 ${active ? 'bg-brand-50/70 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'}`}
      >
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full" style={{ background: topicColor(e.topic) }} aria-hidden />
        <span className="flex items-center justify-between gap-2 md:block">
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{clock(e.occurredAt)}</span>
          <TopicTag topic={e.topic} className="md:hidden" />
        </span>
        <TopicTag topic={e.topic} className="hidden md:inline-flex" />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{e.eventType}</span>
            {e.severity !== 'INFO' && <SeverityBadge severity={e.severity} />}
          </span>
          <span className="muted block truncate text-xs">{summary}</span>
        </span>
        <span className="flex items-center gap-2 font-mono text-[11px] text-slate-500 md:justify-end dark:text-slate-400">
          <span title={`key ${e.key}`} className="truncate">{shortId(e.key)}</span>
          <span className="shrink-0 whitespace-nowrap rounded bg-slate-100 px-1.5 py-px text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
            p{e.partition ?? '–'}{e.offset != null ? ` · ${e.offset}` : ''}
          </span>
        </span>
      </button>
    </li>
  )
}

const TRAIL_ICON = (e) => {
  if (e.severity === 'CRITICAL' || /FAILED/.test(e.eventType)) return { icon: XCircle, cls: 'text-rose-500' }
  if (e.severity === 'WARNING') return { icon: AlertTriangle, cls: 'text-amber-500' }
  if (/COMPLETED|CLEARED|UPDATED|CREATED/.test(e.eventType)) return { icon: CheckCircle2, cls: 'text-emerald-500' }
  return { icon: CircleDot, cls: 'text-slate-400' }
}

function Inspector({ event: e, trail, onFollow, following, onSelect, bare = false }) {
  const wrap = (node) => (bare ? node : <Card>{node}</Card>)
  if (!e) {
    return wrap(
      <EmptyState icon={Braces} title="Inspect an event" message="Select any row to see the raw message, its Kafka coordinates and the rest of its saga." />,
    )
  }
  const message = toMessage(e)
  const t0 = trail.length ? new Date(trail[0].occurredAt).getTime() : 0
  return wrap(
    <div className={bare ? 'space-y-5' : ''}>
      {!bare && (
        <CardHeader
          icon={Braces}
          title={<span className="font-mono text-sm">{e.eventType}</span>}
          subtitle={e.source}
          action={<SeverityBadge severity={e.severity} />}
        />
      )}
      <div className={bare ? 'space-y-5' : 'space-y-5 p-5'}>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ['Partition', e.partition ?? '—'],
            ['Offset', e.offset ?? '—'],
            ['Schema', `v${e.schemaVersion ?? 1}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 px-2 py-2 dark:bg-white/[0.03]">
              <p className="muted text-[11px]">{k}</p>
              <p className="heading tabular truncate font-mono text-sm font-semibold">{v}</p>
            </div>
          ))}
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2"><span className="muted">Topic</span><TopicTag topic={e.topic} full /></div>
          <div className="flex items-center justify-between gap-2"><span className="muted">Key</span><span className="flex min-w-0 items-center gap-1 font-mono text-slate-700 dark:text-slate-200"><span className="truncate">{e.key}</span><CopyButton value={e.key} label="Copy key" /></span></div>
          <div className="flex items-center justify-between gap-2"><span className="muted">Correlation</span><span className="flex min-w-0 items-center gap-1 font-mono text-slate-700 dark:text-slate-200"><span className="truncate">{e.correlationId || '—'}</span>{e.correlationId && <CopyButton value={e.correlationId} label="Copy correlation ID" />}</span></div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="heading text-xs font-semibold uppercase tracking-wide">Message</p>
            <CopyButton value={JSON.stringify(message, null, 2)} label="Copy JSON" />
          </div>
          <JsonView value={message} className="max-h-[300px]" />
          <p className="muted mt-1.5 text-[11px]">First 7 fields are the BaseEvent envelope; the rest is the {e.eventType} payload.</p>
        </div>

        {e.correlationId && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="heading text-xs font-semibold uppercase tracking-wide">Saga trail</p>
              {following === e.correlationId ? (
                <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => onFollow('')}><X size={13} /> Unfollow</button>
              ) : (
                <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => onFollow(e.correlationId)}><GitBranch size={13} /> Follow correlation</button>
              )}
            </div>
            <ol className="space-y-1">
              {trail.map((t) => {
                const { icon: Icon, cls } = TRAIL_ICON(t)
                const current = t.eventId === e.eventId
                return (
                  <li key={t.eventId}>
                    <button type="button" onClick={() => onSelect(t)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${current ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}>
                      <Icon size={14} className={`shrink-0 ${cls}`} />
                      <span className="truncate font-mono font-medium text-slate-800 dark:text-slate-100">{t.eventType}</span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-400">+{Math.max(0, new Date(t.occurredAt).getTime() - t0)}ms</span>
                    </button>
                  </li>
                )
              })}
              {trail.length <= 1 && <li className="muted px-2 text-xs">Other events of this flow are not in the buffer yet. Follow it to load them.</li>}
            </ol>
          </div>
        )}
      </div>
    </div>,
  )
}
