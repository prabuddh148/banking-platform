import { ArrowDownRight, ArrowUpRight, Bell, Code2, Database, FileClock, Globe, Landmark, Radio, Repeat, ShieldAlert, ShieldCheck, Wallet } from 'lucide-react'
import { Badge } from '../ui/Primitives.jsx'
import { EDGE_NODES, SERVICES, TOPICS } from './archData.js'

export const SERVICE_ICONS = { account: Wallet, transaction: Repeat, fraud: ShieldAlert, notification: Bell, audit: FileClock }
const topicById = Object.fromEntries(TOPICS.map((t) => [t.id, t]))
const serviceById = Object.fromEntries(SERVICES.map((s) => [s.id, s]))

/* ----------------------------------------------------------- geometry */
const W = 860
const H = 548
const SVC_Y = 236
const SVC_W = 152
const SVC_H = 68
const DB_Y = 354
const DB_W = 112
const DB_H = 52
const BUS_Y = 458
const centers = [86, 258, 430, 602, 774]

/** Is this edge part of what's selected? (null selection = everything is "on") */
function edgeActive(sel, kind, serviceId) {
  if (!sel) return true
  if (sel.type === 'service') return sel.id === serviceId
  if (sel.type === 'gateway') return kind === 'http'
  if (sel.type === 'browser') return kind === 'http-in'
  if (sel.type === 'topic') {
    const t = topicById[sel.id]
    if (kind === 'pub') return t.producer === serviceId
    if (kind === 'sub') return serviceById[serviceId].consumes.some((c) => c.topic === sel.id)
  }
  return false
}

function nodeKeyHandler(fn) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }
}

function Box({ x, y, w, h, selected, dim, onClick, label, children }) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      onKeyDown={nodeKeyHandler(onClick)}
      className={`group cursor-pointer outline-none transition-opacity duration-300 ${dim ? 'opacity-50' : 'opacity-100'}`}
    >
      {selected && <rect x={x - 5} y={y - 5} width={w + 10} height={h + 10} rx={18} className="fill-brand-500/10 dark:fill-brand-400/10" />}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={14}
        strokeWidth={selected ? 2 : 1}
        className={`transition-colors ${selected ? 'fill-white stroke-brand-500 dark:fill-ink-850 dark:stroke-brand-400' : 'fill-white stroke-slate-200 group-hover:stroke-brand-300 group-focus-visible:stroke-brand-500 dark:fill-ink-850 dark:stroke-white/10 dark:group-hover:stroke-brand-400/60'}`}
      />
      {children}
    </g>
  )
}

function Cylinder({ cx, y, w, h, label, dim, onClick, selected }) {
  const x0 = cx - w / 2
  const ry = 7
  return (
    <g onClick={onClick} className={`cursor-pointer transition-opacity duration-300 ${dim ? 'opacity-50' : 'opacity-100'}`}>
      <path
        d={`M${x0} ${y + ry} v${h - 2 * ry} a${w / 2} ${ry} 0 0 0 ${w} 0 v${-(h - 2 * ry)}`}
        strokeWidth={selected ? 1.5 : 1}
        className={selected ? 'fill-sky-50 stroke-sky-500 dark:fill-sky-500/10 dark:stroke-sky-400' : 'fill-slate-50 stroke-slate-300 dark:fill-white/[0.03] dark:stroke-white/15'}
      />
      <ellipse
        cx={cx}
        cy={y + ry}
        rx={w / 2}
        ry={ry}
        strokeWidth={selected ? 1.5 : 1}
        className={selected ? 'fill-sky-100 stroke-sky-500 dark:fill-sky-500/20 dark:stroke-sky-400' : 'fill-white stroke-slate-300 dark:fill-ink-800 dark:stroke-white/15'}
      />
      <text x={cx} y={y + h / 2 + 9} textAnchor="middle" className="fill-slate-600 font-mono text-[11px] dark:fill-slate-300">{label}</text>
    </g>
  )
}

function Edge({ d, kind, active, marker }) {
  const styles = {
    pub: 'stroke-brand-500 dark:stroke-brand-400',
    sub: 'stroke-emerald-500 dark:stroke-emerald-400',
    http: 'stroke-slate-300 dark:stroke-white/20',
    'http-in': 'stroke-slate-300 dark:stroke-white/20',
    db: 'stroke-slate-300 dark:stroke-white/15',
  }
  const animated = kind === 'pub' || kind === 'sub' || ((kind === 'http' || kind === 'http-in') && active)
  return (
    <path
      d={d}
      fill="none"
      strokeWidth={active ? 2 : 1.5}
      strokeDasharray={animated ? '6 6' : undefined}
      markerEnd={marker ? `url(#${marker})` : undefined}
      className={`${styles[kind]} transition-opacity duration-300 ${animated ? 'animate-flow' : ''} ${active ? 'opacity-100' : 'opacity-25'}`}
    />
  )
}

/**
 * Interactive system diagram (desktop). `selected` = {type: 'browser'|'gateway'|'service'|'topic', id}.
 */
export default function SystemDiagram({ selected, onSelect }) {
  const sel = selected
  const isSel = (type, id) => sel?.type === type && (id === undefined || sel.id === id)
  const toggle = (next) => onSelect(isSel(next.type, next.id) ? null : next)
  const svcDim = (id) => {
    if (!sel) return false
    if (sel.type === 'service') return sel.id !== id
    if (sel.type === 'topic') {
      const t = topicById[sel.id]
      return !(t.producer === id || t.consumers.includes(id))
    }
    return sel.type === 'browser'
  }
  const httpActive = (id) => !sel || sel.type === 'gateway' || (sel.type === 'service' && sel.id === id)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="group" aria-label="System architecture diagram">
      <defs>
        {[
          ['arrow-pub', 'fill-brand-500 dark:fill-brand-400'],
          ['arrow-sub', 'fill-emerald-500 dark:fill-emerald-400'],
          ['arrow-http', 'fill-slate-400 dark:fill-slate-500'],
        ].map(([id, cls]) => (
          <marker key={id} id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className={cls} />
          </marker>
        ))}
      </defs>

      {/* browser → gateway */}
      <Edge d="M430 66 L430 108" kind="http-in" active={!sel || sel.type === 'browser' || sel.type === 'gateway'} marker="arrow-http" />
      <text x={442} y={92} className="fill-slate-500 text-[11px] font-medium dark:fill-slate-400">HTTPS · Bearer JWT</text>

      {/* gateway → services */}
      {SERVICES.map((s, i) => (
        <Edge key={s.id} d={`M430 174 C430 210, ${centers[i]} 200, ${centers[i]} ${SVC_Y - 4}`} kind="http" active={httpActive(s.id)} marker="arrow-http" />
      ))}

      {/* services → db, services ↔ kafka */}
      {SERVICES.map((s, i) => {
        const c = centers[i]
        const pubX = s.publishes ? c + 46 : null
        const subX = s.publishes ? c + 64 : c + 52
        return (
          <g key={s.id}>
            <Edge d={`M${c - 22} ${SVC_Y + SVC_H} L${c - 22} ${DB_Y}`} kind="db" active={!sel || isSel('service', s.id)} />
            {pubX && <Edge d={`M${pubX} ${SVC_Y + SVC_H} L${pubX} ${BUS_Y - 4}`} kind="pub" active={edgeActive(sel, 'pub', s.id)} marker="arrow-pub" />}
            <Edge d={`M${subX} ${BUS_Y} L${subX} ${SVC_Y + SVC_H + 4}`} kind="sub" active={edgeActive(sel, 'sub', s.id)} marker="arrow-sub" />
          </g>
        )
      })}

      {/* browser node */}
      <Box x={320} y={12} w={220} h={54} selected={isSel('browser')} dim={sel && !isSel('browser') && !isSel('gateway')} onClick={() => toggle({ type: 'browser', id: 'browser' })} label="React frontend: show details">
        <Globe x={338} y={30} width={18} height={18} className="text-sky-500" />
        <text x={364} y={38} className="heading fill-slate-900 text-[15px] font-semibold dark:fill-white">React frontend</text>
        <text x={364} y={55} className="fill-slate-500 text-[11px] dark:fill-slate-400">Customer app + ops console</text>
      </Box>

      {/* gateway node */}
      <Box x={300} y={112} w={260} h={62} selected={isSel('gateway')} dim={sel && !isSel('gateway') && !isSel('browser') && sel.type !== 'service'} onClick={() => toggle({ type: 'gateway', id: 'gateway' })} label="API gateway: show details">
        <rect x={316} y={127} width={32} height={32} rx={9} className="fill-brand-600" />
        <ShieldCheck x={324} y={135} width={16} height={16} className="text-white" />
        <text x={360} y={141} className="fill-slate-900 text-[15px] font-semibold dark:fill-white">api-gateway</text>
        <text x={360} y={159} className="fill-slate-500 text-[11px] dark:fill-slate-400">JWT · routing · circuit breakers</text>
        <rect x={500} y={103} width={48} height={18} rx={9} className="fill-slate-100 stroke-slate-200 dark:fill-ink-800 dark:stroke-white/10" />
        <text x={524} y={116} textAnchor="middle" className="fill-slate-600 font-mono text-[10.5px] dark:fill-slate-300">:8080</text>
      </Box>

      {/* service nodes + databases */}
      {SERVICES.map((s, i) => {
        const c = centers[i]
        const x = c - SVC_W / 2
        const Icon = SERVICE_ICONS[s.id]
        const selectedNode = isSel('service', s.id)
        const dim = svcDim(s.id)
        return (
          <g key={s.id}>
            <Box x={x} y={SVC_Y} w={SVC_W} h={SVC_H} selected={selectedNode} dim={dim} onClick={() => toggle({ type: 'service', id: s.id })} label={`${s.name}: show details`}>
              <rect x={x + 12} y={SVC_Y + 13} width={28} height={28} rx={8} className={selectedNode ? 'fill-brand-600' : 'fill-brand-50 dark:fill-brand-500/15'} />
              <Icon x={x + 18} y={SVC_Y + 19} width={16} height={16} className={selectedNode ? 'text-white' : 'text-brand-600 dark:text-brand-300'} />
              <text x={x + 48} y={SVC_Y + 32} className="fill-slate-900 text-[14.5px] font-semibold dark:fill-white">{s.short}</text>
              <text x={x + 12} y={SVC_Y + 58} className="fill-slate-500 text-[11px] dark:fill-slate-400">{s.tables.length} {s.tables.length === 1 ? 'table' : 'tables'} · {s.tests} tests</text>
              <rect x={x + SVC_W - 52} y={SVC_Y - 9} width={46} height={18} rx={9} className="fill-slate-100 stroke-slate-200 dark:fill-ink-800 dark:stroke-white/10" />
              <text x={x + SVC_W - 29} y={SVC_Y + 4} textAnchor="middle" className="fill-slate-600 font-mono text-[10.5px] dark:fill-slate-300">:{s.port}</text>
            </Box>
            <Cylinder cx={c - 22} y={DB_Y} w={DB_W} h={DB_H} label={s.db} dim={dim} selected={selectedNode} onClick={() => toggle({ type: 'service', id: s.id })} />
          </g>
        )
      })}

      {/* kafka bus */}
      <g>
        <rect x={12} y={BUS_Y} width={836} height={80} rx={16} className="fill-slate-900 dark:fill-black/40 dark:stroke-white/10" strokeWidth={1} />
        <Radio x={28} y={BUS_Y + 10} width={14} height={14} className="text-amber-400" />
        <text x={48} y={BUS_Y + 22} className="fill-white text-[12.5px] font-semibold">Apache Kafka</text>
        <text x={136} y={BUS_Y + 22} className="fill-slate-400 text-[11px]">4 topics · 3 partitions each · keyed by aggregate id · a .DLT per topic</text>
        {TOPICS.map((t, i) => {
          const tx = 26 + i * 204
          const on = isSel('topic', t.id)
          const dim = sel && sel.type === 'topic' && !on
          return (
            <g
              key={t.id}
              role="button"
              tabIndex={0}
              aria-label={`Topic ${t.name}: show details`}
              aria-pressed={on}
              onClick={() => toggle({ type: 'topic', id: t.id })}
              onKeyDown={nodeKeyHandler(() => toggle({ type: 'topic', id: t.id }))}
              className={`cursor-pointer outline-none transition-opacity ${dim ? 'opacity-50' : ''}`}
            >
              <rect x={tx} y={BUS_Y + 34} width={196} height={32} rx={9} className={on ? 'fill-amber-400/20 stroke-amber-400' : 'fill-white/[0.06] stroke-white/10 hover:fill-white/[0.12]'} strokeWidth={1} />
              <text x={tx + 98} y={BUS_Y + 54} textAnchor="middle" className={`font-mono text-[11px] ${on ? 'fill-amber-200' : 'fill-slate-200'}`}>{t.name}</text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/* ------------------------------------------------------- mobile version */

export function StackedDiagram({ selected, onSelect }) {
  const isSel = (type, id) => selected?.type === type && selected.id === id
  const toggle = (next) => onSelect(isSel(next.type, next.id) ? null : next)
  const row = (active) =>
    `flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? 'border-brand-500 bg-brand-50/60 dark:border-brand-400 dark:bg-brand-500/10' : 'border-slate-200 bg-white hover:border-brand-300 dark:border-white/10 dark:bg-ink-850 dark:hover:border-brand-400/50'}`
  const connector = <div className="ml-6 h-4 w-px bg-slate-300 dark:bg-white/15" aria-hidden />
  return (
    <div>
      <button type="button" className={row(isSel('browser', 'browser'))} onClick={() => toggle({ type: 'browser', id: 'browser' })}>
        <Globe size={18} className="shrink-0 text-sky-500" />
        <span className="heading text-sm font-semibold">React frontend</span>
        <span className="muted ml-auto text-xs">HTTPS + JWT</span>
      </button>
      {connector}
      <button type="button" className={row(isSel('gateway', 'gateway'))} onClick={() => toggle({ type: 'gateway', id: 'gateway' })}>
        <ShieldCheck size={18} className="shrink-0 text-brand-600 dark:text-brand-300" />
        <span className="heading text-sm font-semibold">api-gateway</span>
        <span className="muted ml-auto font-mono text-xs">:8080</span>
      </button>
      {connector}
      <div className="space-y-2 border-l border-slate-300 pl-4 dark:border-white/15" style={{ marginLeft: 24 }}>
        {SERVICES.map((s) => {
          const Icon = SERVICE_ICONS[s.id]
          return (
            <button key={s.id} type="button" className={row(isSel('service', s.id))} onClick={() => toggle({ type: 'service', id: s.id })}>
              <Icon size={18} className="shrink-0 text-brand-600 dark:text-brand-300" />
              <span className="min-w-0">
                <span className="heading block text-sm font-semibold">{s.name}</span>
                <span className="muted flex items-center gap-1 font-mono text-[11px]"><Database size={11} /> {s.db}</span>
              </span>
              <span className="muted ml-auto font-mono text-xs">:{s.port}</span>
            </button>
          )
        })}
      </div>
      {connector}
      <div className="rounded-xl bg-slate-900 p-3 dark:bg-black/40 dark:ring-1 dark:ring-white/10">
        <p className="flex items-center gap-2 text-xs font-semibold text-white"><Radio size={14} className="text-amber-400" /> Apache Kafka</p>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {TOPICS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle({ type: 'topic', id: t.id })}
              className={`rounded-lg px-2.5 py-1.5 text-left font-mono text-[11px] ring-1 transition-colors ${isSel('topic', t.id) ? 'bg-amber-400/20 text-amber-200 ring-amber-400' : 'bg-white/[0.06] text-slate-200 ring-white/10 hover:bg-white/[0.12]'}`}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- detail panel */

function Section({ title, children }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{title}</p>
      {children}
    </div>
  )
}

function EventChips({ events, tone }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {events.map((e) => <Badge key={e} tone={tone} className="font-mono !text-[10.5px]">{e}</Badge>)}
    </div>
  )
}

export function NodeDetail({ selected }) {
  if (!selected) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
          <Landmark size={22} />
        </div>
        <p className="heading mt-3 text-sm font-semibold">Pick any box</p>
        <p className="muted mt-1 max-w-[16rem] text-xs leading-relaxed">
          Click a service, the gateway or a Kafka topic to see what it owns, what it publishes and consumes, and the key classes behind it.
        </p>
        <div className="mt-5 grid w-full max-w-[15rem] gap-2 text-left text-xs">
          <p className="muted flex items-center gap-2"><span className="h-0.5 w-6 rounded bg-brand-500" /> publishes events</p>
          <p className="muted flex items-center gap-2"><span className="h-0.5 w-6 rounded bg-emerald-500" /> consumes events</p>
          <p className="muted flex items-center gap-2"><span className="h-0.5 w-6 rounded bg-slate-300 dark:bg-white/20" /> HTTP (gateway only)</p>
        </div>
      </div>
    )
  }

  if (selected.type === 'topic') {
    const t = topicById[selected.id]
    return (
      <div key={t.id} className="animate-fade-in space-y-4 p-5">
        <div>
          <Badge tone="amber" dot>Kafka topic</Badge>
          <p className="heading mt-2 break-all font-mono text-sm font-semibold">{t.name}</p>
          <p className="muted mt-1 text-xs">3 partitions · retention {t.retention} · DLT <span className="font-mono">{t.name}.DLT</span></p>
        </div>
        <Section title="Producer"><p className="heading text-sm">{serviceById[t.producer]?.name || t.producer}</p></Section>
        <Section title="Consumers">
          <div className="flex flex-wrap gap-1.5">{t.consumers.map((c) => <Badge key={c} tone="green">{serviceById[c].name}</Badge>)}</div>
        </Section>
        <Section title="Events"><EventChips events={t.events} tone="brand" /></Section>
        <Section title="Delivery">
          <ul className="muted list-disc space-y-1 pl-4 text-xs leading-relaxed">
            <li>Key = aggregate id, so one transfer's events stay in order</li>
            <li>Producer acks=all, idempotence on</li>
            <li>3 retries 1 s apart, then the record goes to the DLT</li>
          </ul>
        </Section>
      </div>
    )
  }

  if (selected.type === 'browser' || selected.type === 'gateway') {
    const n = EDGE_NODES[selected.type]
    return (
      <div key={n.id} className="animate-fade-in space-y-4 p-5">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={n.id === 'gateway' ? 'brand' : 'blue'} dot>{n.id === 'gateway' ? 'Edge service' : 'Client'}</Badge>
            <span className="muted font-mono text-xs">:{n.port}</span>
          </div>
          <p className="heading mt-2 font-mono text-sm font-semibold">{n.name}</p>
          <p className="muted mt-1 text-sm leading-relaxed">{n.responsibility}</p>
        </div>
        <dl className="space-y-2.5">
          {n.facts.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{k}</dt>
              <dd className="heading mt-0.5 text-xs leading-relaxed">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }

  const s = serviceById[selected.id]
  const Icon = SERVICE_ICONS[s.id]
  return (
    <div key={s.id} className="animate-fade-in space-y-4 p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white shadow-glow">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <p className="heading font-mono text-sm font-semibold">{s.name}</p>
          <p className="muted text-xs">Port <span className="font-mono">{s.port}</span> · {s.tests} tests</p>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{s.responsibility}</p>
      <Section title={`Database · ${s.db}`}>
        <div className="flex flex-wrap gap-1.5">
          {s.tables.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 font-mono text-[10.5px] text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
              <Database size={10} /> {t}
            </span>
          ))}
        </div>
      </Section>
      <Section title="Publishes">
        {s.publishes ? (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs text-brand-700 dark:text-brand-300">
              <ArrowUpRight size={13} /> <span className="font-mono">{topicById[s.publishes.topic].name}</span>
              <span className="muted">({s.publishes.via === 'outbox' ? 'via outbox' : 'direct, inside the DB txn'})</span>
            </p>
            <EventChips events={s.publishes.events} tone="brand" />
          </div>
        ) : (
          <p className="muted text-xs">Nothing. It only listens.</p>
        )}
      </Section>
      <Section title="Consumes">
        <div className="space-y-2">
          {s.consumes.map((c) => (
            <div key={c.topic} className="space-y-1.5">
              <p className="flex items-center gap-1.5 font-mono text-xs text-emerald-700 dark:text-emerald-300"><ArrowDownRight size={13} /> {topicById[c.topic].name}</p>
              <EventChips events={c.events} tone="green" />
            </div>
          ))}
        </div>
      </Section>
      <Section title="Patterns">
        <ul className="space-y-1">
          {s.patterns.map((p) => (
            <li key={p} className="flex gap-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500" /> {p}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Key classes">
        <div className="flex flex-wrap gap-1.5">
          {s.classes.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-700 dark:bg-white/5 dark:text-slate-300">
              <Code2 size={10} /> {c}
            </span>
          ))}
        </div>
      </Section>
    </div>
  )
}
