// Live view of the transfer saga: one row per backend step, the Kafka events
// behind it, timestamps from the status history and a pulsing current step.
import { Check, X, AlertTriangle, Send, ShieldCheck, Database, CircleCheckBig, Clock } from 'lucide-react'

export const timeWithSeconds = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const STEP_ICON = { requested: Send, fraud: ShieldCheck, balance: Database, done: CircleCheckBig }

const DOT = {
  done: 'bg-emerald-500 text-white shadow-emerald-500/30',
  current: 'bg-brand-600 text-white shadow-brand-600/40',
  warning: 'bg-amber-500 text-white shadow-amber-500/30',
  failed: 'bg-rose-500 text-white shadow-rose-500/30',
  pending: 'bg-slate-100 text-slate-400 shadow-none dark:bg-white/[0.06] dark:text-slate-500',
}

const STATE_LABEL = { done: 'Done', current: 'In progress', warning: 'Needs review', failed: 'Failed', pending: 'Waiting' }
const STATE_TEXT = {
  done: 'text-emerald-700 dark:text-emerald-300',
  current: 'text-brand-700 dark:text-brand-300',
  warning: 'text-amber-700 dark:text-amber-300',
  failed: 'text-rose-700 dark:text-rose-300',
  pending: 'text-slate-400 dark:text-slate-500',
}

function EventChip({ e }) {
  const styles = {
    done: 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200',
    failed: 'border-rose-200 bg-rose-50/70 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200',
    pending: 'border-dashed border-slate-200 bg-transparent text-slate-400 dark:border-white/10 dark:text-slate-500',
  }
  const Icon = e.state === 'done' ? Check : e.state === 'failed' ? X : Clock
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] font-medium ${styles[e.state] || styles.pending}`} title={`${e.topic} (produced by ${e.producer})`}>
      <Icon size={11} aria-hidden /> {e.name}
    </span>
  )
}

/** steps: output of sagaSteps(). */
export default function SagaTracker({ steps, compact = false }) {
  const doneCount = steps.filter((s) => s.state === 'done').length
  const progress = steps.some((s) => s.state === 'failed') ? 100 : (doneCount / steps.length) * 100
  const barTone = steps.some((s) => s.state === 'failed') ? 'bg-rose-500' : steps.some((s) => s.state === 'warning') ? 'bg-amber-500' : 'bg-gradient-to-r from-brand-500 to-emerald-500'

  return (
    <div>
      {!compact && (
        <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Saga progress">
          <div className={`h-full rounded-full transition-all duration-700 ${barTone}`} style={{ width: `${Math.max(progress, 6)}%` }} />
        </div>
      )}
      <ol className="relative">
        {steps.map((s, i) => {
          const Icon = s.state === 'failed' ? X : s.state === 'warning' ? AlertTriangle : s.state === 'done' ? Check : STEP_ICON[s.key]
          const last = i === steps.length - 1
          return (
            <li key={s.key} className={`relative flex gap-4 ${last ? '' : 'pb-6'}`}>
              {!last && (
                <span className={`absolute left-[19px] top-11 h-[calc(100%-2.75rem)] w-0.5 rounded-full transition-colors duration-500 ${s.state === 'done' ? 'bg-emerald-400/70 dark:bg-emerald-500/50' : 'bg-slate-200 dark:bg-white/10'}`} aria-hidden />
              )}
              <span className={`relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full shadow-lg transition-colors duration-500 ${DOT[s.state]}`}>
                {s.state === 'current' && <span className="absolute inset-0 rounded-full bg-brand-500 animate-pulse-ring" aria-hidden />}
                <Icon size={18} className="relative" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className={`text-sm font-semibold ${s.state === 'pending' ? 'text-slate-400 dark:text-slate-500' : 'heading'}`}>
                    {s.title}
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 align-middle font-mono text-[10px] font-medium text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">{s.service}</span>
                  </p>
                  <p className={`text-xs font-medium ${STATE_TEXT[s.state]}`}>
                    {STATE_LABEL[s.state]}{s.time ? <span className="tabular ml-1.5 font-mono text-[11px] text-slate-400">{timeWithSeconds(s.time)}</span> : null}
                  </p>
                </div>
                {s.description && !compact && <p className="muted mt-1 text-xs leading-relaxed">{s.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.events.map((e) => <EventChip key={e.name} e={e} />)}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
