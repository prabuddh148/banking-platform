// Small, dependency-free UI primitives used across customer + admin pages.
// Every component supports dark mode (Tailwind `dark:` classes).
// Charts live in ./Charts.jsx (re-exported at the bottom for older imports).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { USE_MOCK } from '../../lib/config.js'

/* ------------------------------------------------------------------ layout */

export function PageHeader({ title, subtitle, action, eyebrow }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">{eyebrow}</p>}
        <h1 className="heading text-2xl font-bold tracking-tight sm:text-[26px]">{title}</h1>
        {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

export function Card({ children, className = '', ...rest }) {
  return <div className={`card ${className}`} {...rest}>{children}</div>
}

/** Title row inside a card: title, optional subtitle and a right-hand action. */
export function CardHeader({ title, subtitle, action, icon: Icon, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-3 px-5 pt-5 ${className}`}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
            <Icon size={18} />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="heading text-[15px] font-semibold">{title}</h2>
          {subtitle && <p className="muted mt-0.5 text-xs">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

const iconTones = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300',
  green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  red: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300',
  blue: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
}

/**
 * KPI tile. `delta` = { up: bool, label: '+4.2% vs last week', good?: bool }.
 * `footer` (e.g. a <Sparkline/>) renders under the value.
 */
export function StatCard({ label, value, delta, icon: Icon, tone = 'brand', footer, hint }) {
  const good = delta ? (delta.good ?? delta.up) : true
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="muted text-sm font-medium">{label}</p>
          <p className="heading tabular mt-2 truncate text-2xl font-bold tracking-tight">{value}</p>
        </div>
        {Icon && (
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${iconTones[tone] || iconTones.brand}`}>
            <Icon size={20} />
          </div>
        )}
      </div>
      {delta && (
        <p className={`mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${good ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'}`}>
          <span aria-hidden>{delta.up ? '▲' : '▼'}</span> {delta.label}
        </p>
      )}
      {hint && <p className="muted mt-2 text-xs">{hint}</p>}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ badges */

const badgeTones = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20',
}

export function Badge({ children, tone = 'slate', dot = false, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeTones[tone] || badgeTones.slate} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

// Maps common status strings to a badge tone so the same component works
// for accounts, transactions, fraud cases, and services.
const STATUS_TONES = {
  Active: 'green', Operational: 'green', Posted: 'green', Cleared: 'green', Completed: 'green',
  Approved: 'green', Sent: 'green', Delivered: 'green', UP: 'green', Up: 'green', Low: 'green', LOW: 'green',
  Pending: 'amber', Reviewing: 'amber', Degraded: 'amber', 'Under Review': 'amber', Medium: 'amber', MEDIUM: 'amber', Warning: 'amber', WARNING: 'amber',
  Processing: 'blue', Info: 'blue', INFO: 'blue',
  Dormant: 'slate', Closed: 'slate', Unknown: 'slate',
  Open: 'red', Blocked: 'red', Rejected: 'red', Frozen: 'red', Down: 'red', DOWN: 'red', Failed: 'red',
  High: 'red', HIGH: 'red', Critical: 'red', CRITICAL: 'red',
}

export function statusTone(status) {
  return STATUS_TONES[status] || 'slate'
}

export function StatusBadge({ status }) {
  return <Badge tone={statusTone(status)} dot>{status}</Badge>
}

/* ------------------------------------------------------------------ people */

function initialsOf(name = '') {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?'
}

// Deterministic gradient per name, so the same person always gets the same avatar
const AVATAR_GRADIENTS = [
  'from-brand-500 to-violet-500', 'from-sky-500 to-cyan-400', 'from-emerald-500 to-teal-400',
  'from-amber-500 to-orange-400', 'from-rose-500 to-pink-400', 'from-fuchsia-500 to-purple-500',
]

export function Avatar({ name, size = 32, className = '' }) {
  const hash = [...(name || '?')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-semibold text-white ${AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      aria-hidden
    >
      {initialsOf(name)}
    </div>
  )
}

/* ------------------------------------------------------------------ inputs */

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input className="input pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && (
        <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Clear search">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

/** Pill-style toggle group. options: [{ value, label, count? }] */
export function Segmented({ options, value, onChange, size = 'md' }) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-xl bg-slate-100 p-1 dark:bg-white/[0.05]">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-all ${pad} ${active ? 'bg-white text-slate-900 shadow-sm dark:bg-ink-700 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
          >
            {o.label}
            {o.count !== undefined && <span className={`rounded-full px-1.5 text-[10px] font-semibold ${active ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200' : 'bg-slate-200/70 text-slate-500 dark:bg-white/10 dark:text-slate-400'}`}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Underlined tabs. tabs: [{ value, label, icon? }] */
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 scrollbar-thin dark:border-white/10">
      {tabs.map((t) => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${active ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
          >
            {t.icon && <t.icon size={16} />}
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export function CopyButton({ value, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false)
  async function copy(e) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(String(value))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked: nothing else to do
    }
  }
  return (
    <button type="button" onClick={copy} title={copied ? 'Copied' : label} aria-label={label} className={`inline-flex items-center rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200 ${className}`}>
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </button>
  )
}

/* ------------------------------------------------------------------ overlays */

// Stack of open overlays: Esc closes only the topmost one (e.g. a drawer opened from a drawer).
const overlayStack = []

function useLockScroll(open, onClose) {
  useEffect(() => {
    if (!open) return undefined
    const token = {}
    overlayStack.push(token)
    const onKey = (e) => {
      if (e.key === 'Escape' && overlayStack[overlayStack.length - 1] === token) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      overlayStack.splice(overlayStack.indexOf(token), 1)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
}

/** Centered dialog. Close with Esc, the X or a click on the backdrop. */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useLockScroll(open, onClose)
  if (!open) return null
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size]
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={`card relative w-full ${width} max-h-[90vh] overflow-hidden shadow-lift animate-scale-in dark:bg-ink-850`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-white/[0.06]">
          <div>
            <h2 className="heading text-base font-semibold">{title}</h2>
            {subtitle && <p className="muted mt-0.5 text-sm">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="btn-icon -mr-2 -mt-1 h-8 w-8" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="max-h-[calc(90vh-8rem)] overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-white/[0.06]">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** Panel sliding in from the right (details views). */
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-md' }) {
  useLockScroll(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label={title} className={`absolute inset-y-0 right-0 flex w-full ${width} flex-col border-l border-slate-200 bg-white shadow-lift animate-slide-in-right dark:border-white/10 dark:bg-ink-900`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-white/[0.06]">
          <div className="min-w-0">
            <h2 className="heading truncate text-base font-semibold">{title}</h2>
            {subtitle && <p className="muted mt-0.5 text-sm">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="btn-icon -mr-2 h-8 w-8" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 scrollbar-thin">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-white/[0.06]">{footer}</div>}
      </aside>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------ data display */

/** Label / value rows for detail panels. items: [{ label, value, mono?, copy? }] */
export function KeyValue({ items }) {
  return (
    <dl className="divide-y divide-slate-100 dark:divide-white/[0.06]">
      {items.filter(Boolean).map((it) => (
        <div key={it.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
          <dt className="muted shrink-0">{it.label}</dt>
          <dd className={`flex min-w-0 items-center gap-1 text-right font-medium text-slate-800 dark:text-slate-100 ${it.mono ? 'font-mono text-xs' : ''}`}>
            <span className="truncate">{it.value ?? '—'}</span>
            {it.copy && <CopyButton value={it.copy === true ? it.value : it.copy} />}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Vertical timeline. items: [{ title, description?, time?, state: 'done'|'current'|'pending'|'failed'|'warning', icon? }]
 */
export function Timeline({ items }) {
  const dot = {
    done: 'bg-emerald-500 text-white',
    current: 'bg-brand-600 text-white',
    pending: 'bg-slate-200 text-slate-400 dark:bg-white/10 dark:text-slate-500',
    failed: 'bg-rose-500 text-white',
    warning: 'bg-amber-500 text-white',
  }
  return (
    <ol className="relative">
      {items.map((it, i) => {
        const Icon = it.icon
        const last = i === items.length - 1
        return (
          <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span className={`absolute left-[13px] top-7 h-[calc(100%-1.5rem)] w-0.5 ${it.state === 'done' ? 'bg-emerald-300 dark:bg-emerald-500/40' : 'bg-slate-200 dark:bg-white/10'}`} />}
            <span className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-4 ring-white dark:ring-ink-900 ${dot[it.state] || dot.pending}`}>
              {it.state === 'current' && <span className="absolute inset-0 rounded-full bg-brand-500 animate-pulse-ring" />}
              {Icon ? <Icon size={14} className="relative" /> : <span className="relative h-2 w-2 rounded-full bg-current" />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={`text-sm font-medium ${it.state === 'pending' ? 'text-slate-400 dark:text-slate-500' : 'heading'}`}>{it.title}</p>
              {it.description && <p className="muted mt-0.5 text-xs leading-relaxed">{it.description}</p>}
              {it.time && <p className="mt-0.5 font-mono text-[11px] text-slate-400">{it.time}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Simple prev/next pager for client-side lists. */
export function Pagination({ page, pageCount, onChange, total, pageSize }) {
  if (pageCount <= 1) return null
  const from = page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm dark:border-white/[0.06]">
      <p className="muted tabular">{from}–{to} of {total}</p>
      <div className="flex items-center gap-1">
        <button type="button" className="btn-icon h-8 w-8 disabled:opacity-40" disabled={page === 0} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
        <span className="tabular px-2 text-xs font-medium text-slate-600 dark:text-slate-300">{page + 1} / {pageCount}</span>
        <button type="button" className="btn-icon h-8 w-8 disabled:opacity-40" disabled={page >= pageCount - 1} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ states */

export function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="grid place-items-center px-4 py-16 text-center">
      {Icon && (
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500">
          <Icon size={26} />
        </div>
      )}
      <p className="heading mt-4 font-semibold">{title}</p>
      {message && <p className="muted mt-1 max-w-sm text-sm">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ size = 16, className = '' }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />
}

/** Shimmering placeholder block. */
export function Skeleton({ className = '' }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-slate-200/70 dark:bg-white/[0.06] ${className}`}>
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer dark:via-white/[0.06]" />
    </div>
  )
}

/** A few skeleton rows, used as the loading state of lists and cards. */
export function LoadingState({ label = 'Loading…', rows = 4 }) {
  return (
    <div className="space-y-3 p-5" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}

// Shows an ApiError (message + backend error code) with an optional retry button.
export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  const isNetwork = error?.code === 'NETWORK_ERROR'
  return (
    <div className="grid place-items-center px-4 py-14 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
        <AlertTriangle size={24} />
      </div>
      <p className="heading mt-3 font-semibold">{title}</p>
      <p className="muted mt-1 max-w-md text-sm">{error?.message || 'Unexpected error.'}</p>
      {error?.code && <p className="mt-1 font-mono text-xs text-slate-400">{error.code}{error.status ? ` · HTTP ${error.status}` : ''}</p>}
      {isNetwork && !USE_MOCK && (
        <p className="mt-2 max-w-md text-xs text-slate-400">
          Start the backend (docker compose) or run the UI with <span className="font-mono">VITE_USE_MOCK=true</span>.
        </p>
      )}
      {onRetry && (
        <button className="btn-ghost mt-4" onClick={onRetry}>
          <RefreshCw size={15} /> Try again
        </button>
      )}
    </div>
  )
}

// Inline error banner (form submit errors, partial dashboard failures).
export function ErrorBanner({ error, children }) {
  if (!error && !children) return null
  const details = error?.details && typeof error.details === 'object' ? Object.entries(error.details) : []
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          {error && <p className="font-medium">{error.message}</p>}
          {details.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-xs">
              {details.map(([field, msg]) => <li key={field}><span className="font-mono">{field}</span>: {msg}</li>)}
            </ul>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Renders loading / error states for a useAsync() result, otherwise children(data).
 * While reloading with data already on screen, keeps showing the data.
 */
export function AsyncView({ state, children, loadingLabel, errorTitle, card = false, rows }) {
  const wrap = (node) => (card ? <Card>{node}</Card> : node)
  if (state.error) return wrap(<ErrorState error={state.error} onRetry={state.reload} title={errorTitle} />)
  if (state.loading && state.data === undefined) return wrap(<LoadingState label={loadingLabel} rows={rows} />)
  if (state.data === undefined) return null
  return children(state.data)
}

// Older pages import the simple charts from here.
export { BarChart, Sparkline, CategoryBars } from './Charts.jsx'
