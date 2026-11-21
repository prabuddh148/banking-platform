// Small building blocks shared by the admin console pages.
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, HelpCircle, Info, OctagonAlert, RefreshCw, XCircle } from 'lucide-react'
import { Badge, Spinner } from '../ui/Primitives.jsx'
import { SERIES } from '../ui/Charts.jsx'
import { TOPICS, topicMeta } from '../../services/eventCatalog.js'

/* ------------------------------------------------------------------ topics */

/** Fixed categorical color per topic (catalog order -> --series-1..4). */
export function topicColor(topicId) {
  const i = TOPICS.findIndex((t) => t.id === topicId)
  return i >= 0 ? SERIES[i] : 'var(--chart-muted)'
}

export function TopicTag({ topic, full = false, className = '' }) {
  const meta = topicMeta(topic)
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 ${className}`}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: topicColor(topic) }} />
      <span className={`truncate ${full ? 'font-mono' : ''}`}>{full ? topic || 'unknown' : meta?.short || 'unknown'}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ severity */

const SEVERITY = {
  INFO: { tone: 'slate', icon: Info, label: 'Info' },
  WARNING: { tone: 'amber', icon: AlertTriangle, label: 'Warning' },
  CRITICAL: { tone: 'red', icon: OctagonAlert, label: 'Critical' },
}

export function SeverityBadge({ severity = 'INFO', compact = false }) {
  const s = SEVERITY[severity] || SEVERITY.INFO
  const Icon = s.icon
  return (
    <Badge tone={s.tone}>
      <Icon size={12} aria-hidden />
      {compact ? null : s.label}
      {compact && <span className="sr-only">{s.label}</span>}
    </Badge>
  )
}

/* ------------------------------------------------------------------ risk */

export const RISK_LEVELS = [
  { id: 'LOW', range: '0–29', decision: 'Approve', effect: 'FRAUD_CLEARED', color: 'var(--status-good)', tone: 'green' },
  { id: 'MEDIUM', range: '30–59', decision: 'Approve', effect: 'FRAUD_CLEARED', color: 'var(--status-warning)', tone: 'amber' },
  { id: 'HIGH', range: '60–79', decision: 'Manual review', effect: 'Alert OPEN · txn UNDER_REVIEW', color: 'var(--status-serious)', tone: 'amber' },
  { id: 'CRITICAL', range: '80–100', decision: 'Auto-block', effect: 'Txn FAILED (FRAUD_BLOCKED)', color: 'var(--status-critical)', tone: 'red' },
]

export function riskLevelOf(score) {
  const s = Number(score) || 0
  return s < 30 ? 'LOW' : s < 60 ? 'MEDIUM' : s < 80 ? 'HIGH' : 'CRITICAL'
}

export function riskMeta(level) {
  return RISK_LEVELS.find((r) => r.id === level) || RISK_LEVELS[0]
}

/** Score chip: status-colored ring + number, level as text. */
export function RiskScore({ score, size = 40 }) {
  const level = riskLevelOf(score)
  const m = riskMeta(level)
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full bg-white text-xs font-bold tabular text-slate-900 dark:bg-ink-850 dark:text-white"
      style={{ width: size, height: size, boxShadow: `inset 0 0 0 3px ${m.color}` }}
      title={`Risk ${score} · ${level}`}
      aria-label={`Risk ${score}, ${level}`}
    >
      {score}
    </div>
  )
}

export function RiskLevelBadge({ level }) {
  const m = riskMeta(level)
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-slate-700 dark:bg-white/[0.06] dark:text-slate-200">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      {m.id}
    </span>
  )
}

/** The four decision bands of fraud-service in one compact strip. */
export function RiskBandsLegend({ className = '' }) {
  return (
    <div className={`grid grid-cols-2 gap-2 md:grid-cols-4 ${className}`}>
      {RISK_LEVELS.map((r) => (
        <div key={r.id} className="rounded-xl border border-slate-200/80 bg-white px-3 py-2 dark:border-white/[0.07] dark:bg-white/[0.02]">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100">
              <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />{r.id}
            </span>
            <span className="tabular font-mono text-[11px] text-slate-400">{r.range}</span>
          </div>
          <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">{r.decision}</p>
          <p className="truncate text-[11px] text-slate-400" title={r.effect}>{r.effect}</p>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ services */

const SERVICE_STATUS = {
  Operational: { icon: CheckCircle2, color: 'var(--status-good)', label: 'Operational' },
  Degraded: { icon: AlertTriangle, color: 'var(--status-warning)', label: 'Degraded' },
  Down: { icon: XCircle, color: 'var(--status-critical)', label: 'Down' },
}

export function serviceStatusMeta(status) {
  return SERVICE_STATUS[status] || { icon: HelpCircle, color: 'var(--chart-muted)', label: status || 'Unknown' }
}

export function ServiceStatusIcon({ status, size = 16 }) {
  const m = serviceStatusMeta(status)
  const Icon = m.icon
  return <Icon size={size} style={{ color: m.color }} aria-label={m.label} />
}

/* ------------------------------------------------------------------ tables */

/** Sortable <th>. sort = { field, dir } */
export function SortTh({ label, field, sort, onSort, align = 'left', className = '' }) {
  const active = sort.field === field
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={`${align === 'right' ? 'text-right' : 'text-left'} ${className}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-slate-800 dark:hover:text-slate-100 ${active ? 'text-slate-800 dark:text-slate-100' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <Icon size={12} className={active ? '' : 'opacity-50'} />
      </button>
    </th>
  )
}

export function RefreshButton({ loading, onClick, label = 'Refresh' }) {
  return (
    <button type="button" className="btn-ghost" onClick={onClick} disabled={loading}>
      {loading ? <Spinner size={15} /> : <RefreshCw size={15} />} {label}
    </button>
  )
}

/** Pulsing "live" dot with a label. */
export function LiveDot({ active = true, label }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
      <span className="relative flex h-2.5 w-2.5">
        {active && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 animate-pulse-ring" />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      </span>
      {label}
    </span>
  )
}

/** Delta chip for custom tiles: value in %, `good` decides the color. */
export function DeltaChip({ value, good, suffix = '%', label }) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const up = value >= 0
  const ok = good ?? up
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular ${ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'}`}>
      {up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
      {Math.abs(value).toFixed(suffix === '%' ? 1 : 0)}{suffix}
      {label && <span className="font-medium opacity-80">{label}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------ JSON */

/** Pretty, syntax-colored JSON (keys / strings / numbers / literals), dark-mode aware. */
export function JsonView({ value, className = '' }) {
  return (
    <pre className={`overflow-x-auto rounded-xl bg-slate-50 p-4 font-mono text-[12px] leading-relaxed text-slate-700 ring-1 ring-inset ring-slate-200/80 scrollbar-thin dark:bg-black/30 dark:text-slate-300 dark:ring-white/[0.06] ${className}`}>
      <JsonNode value={value} indent={0} />
    </pre>
  )
}

const pad = (n) => '  '.repeat(n)

function JsonNode({ value, indent }) {
  if (value === null) return <span className="text-rose-600 dark:text-rose-300">null</span>
  if (typeof value === 'number') return <span className="text-sky-700 dark:text-sky-300">{value}</span>
  if (typeof value === 'boolean') return <span className="text-violet-700 dark:text-violet-300">{String(value)}</span>
  if (typeof value === 'string') return <span className="text-emerald-700 dark:text-emerald-300">&quot;{value}&quot;</span>
  if (Array.isArray(value)) {
    if (!value.length) return <span>[]</span>
    return (
      <>
        {'['}
        {value.map((v, i) => (
          <span key={i}>{'\n'}{pad(indent + 1)}<JsonNode value={v} indent={indent + 1} />{i < value.length - 1 ? ',' : ''}</span>
        ))}
        {'\n'}{pad(indent)}{']'}
      </>
    )
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined)
    if (!entries.length) return <span>{'{}'}</span>
    return (
      <>
        {'{'}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {'\n'}{pad(indent + 1)}<span className="text-brand-700 dark:text-brand-300">&quot;{k}&quot;</span>: <JsonNode value={v} indent={indent + 1} />{i < entries.length - 1 ? ',' : ''}
          </span>
        ))}
        {'\n'}{pad(indent)}{'}'}
      </>
    )
  }
  return <span>{String(value)}</span>
}
