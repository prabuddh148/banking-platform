import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, Database, Pause, Play, RotateCcw, X } from 'lucide-react'
import { Badge, CopyButton, Segmented } from '../ui/Primitives.jsx'
import { ACTORS, SAGA_STEPS, SCENARIOS } from './archData.js'

const STATUS_TONE = { PENDING: 'amber', UNDER_REVIEW: 'amber', PROCESSING: 'blue', COMPLETED: 'green', FAILED: 'red' }
const SAGA_TONE = { AWAITING_FRAUD_CHECK: 'amber', AWAITING_REVIEW: 'amber', AWAITING_BALANCE_UPDATE: 'blue', COMPLETED: 'green', FAILED: 'red' }
const actorLabel = Object.fromEntries(ACTORS.map((a) => [a.id, a.label]))

/** Tiny JSON syntax highlighter (keys, strings, numbers, literals). */
function JsonView({ value }) {
  const text = JSON.stringify(value, null, 2)
  const parts = []
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1] && m[2]) parts.push(<span key={m.index} className="text-sky-300">{m[1]}</span>, m[2])
    else if (m[1]) parts.push(<span key={m.index} className="text-emerald-300">{m[1]}</span>)
    else if (m[3]) parts.push(<span key={m.index} className="text-amber-300">{m[3]}</span>)
    else parts.push(<span key={m.index} className="text-violet-300">{m[4]}</span>)
    last = re.lastIndex
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}

function Payload({ step }) {
  const p = step.payload
  const label = p.kind === 'http' ? 'HTTP request' : p.kind === 'event' ? 'Kafka event' : 'Database'
  const title = p.kind === 'event' ? p.body.eventType : p.title
  const shown = p.kind === 'http' ? { headers: p.headers, body: p.body } : p.body
  return (
    <div className="overflow-hidden rounded-xl bg-slate-950 ring-1 ring-slate-900/10 dark:bg-black/50 dark:ring-white/10">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="flex gap-1" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        </span>
        <span className="ml-1 hidden shrink-0 text-[11px] font-medium uppercase tracking-wider text-slate-400 sm:inline">{label}</span>
        <span className="truncate font-mono text-xs text-slate-200">{title}</span>
        {step.topic && p.kind === 'event' && <span className="ml-auto hidden truncate font-mono text-[11px] text-amber-300/90 sm:inline">→ {step.topic}</span>}
        <CopyButton value={JSON.stringify(shown, null, 2)} label="Copy JSON" className={`${step.topic && p.kind === 'event' ? '' : 'ml-auto'} !text-slate-400 hover:!bg-white/10 hover:!text-white`} />
      </div>
      <pre className="scrollbar-thin max-h-[300px] overflow-auto p-4 font-mono text-[11.5px] leading-relaxed text-slate-300">
        <JsonView value={shown} />
      </pre>
    </div>
  )
}

function StateTile({ label, value, tone, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3 dark:border-white/[0.07] dark:bg-white/[0.02]">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Badge key={value} tone={tone} dot className="animate-scale-in font-mono">{value}</Badge>
        {sub && <span className="muted font-mono text-[11px]">{sub}</span>}
      </div>
    </div>
  )
}

export default function SagaPlayer() {
  const [scenario, setScenario] = useState('happy')
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const steps = SAGA_STEPS[scenario]
  const step = steps[index]
  const last = steps.length - 1
  const meta = SCENARIOS.find((s) => s.value === scenario)

  useEffect(() => {
    if (!playing) return undefined
    if (index >= last) {
      setPlaying(false)
      return undefined
    }
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, last)), 2600)
    return () => clearTimeout(t)
  }, [playing, index, last])

  const failedFinal = steps[last].txn === 'FAILED'
  const involved = useMemo(() => new Set(steps.flatMap((s) => [s.from, s.to])), [steps])

  function changeScenario(v) {
    setScenario(v)
    setIndex(0)
    setPlaying(false)
  }

  function togglePlay() {
    if (index >= last) {
      setIndex(0)
      setPlaying(true)
    } else setPlaying((p) => !p)
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-white/[0.06]">
        <div className="min-w-0">
          <h2 className="heading text-[15px] font-semibold">Follow a transfer through the saga</h2>
          <p className="muted mt-0.5 text-xs">{meta.blurb} Every step is one DB transaction plus one event.</p>
        </div>
        <Segmented options={SCENARIOS.map(({ value, label }) => ({ value, label }))} value={scenario} onChange={changeScenario} size="sm" />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* step list */}
        <ol className="border-b border-slate-100 p-3 dark:border-white/[0.06] lg:border-b-0 lg:border-r">
          {steps.map((s, i) => {
            const state = i < index ? 'done' : i === index ? 'current' : 'pending'
            const failed = s.txn === 'FAILED' && state !== 'pending' && s.saga === 'FAILED'
            return (
              <li key={`${scenario}-${i}`}>
                <button
                  type="button"
                  onClick={() => { setIndex(i); setPlaying(false) }}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={`group flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${state === 'current' ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'}`}
                >
                  <span
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition-colors ${
                      state === 'current'
                        ? failed ? 'bg-rose-600 text-white' : 'bg-brand-600 text-white shadow-glow'
                        : state === 'done'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500'
                    }`}
                  >
                    {state === 'done' ? <Check size={12} strokeWidth={3} /> : failed ? <X size={12} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium ${state === 'pending' ? 'text-slate-400 dark:text-slate-500' : 'heading'}`}>{s.title}</span>
                    <span className="block text-[11px] text-slate-400 dark:text-slate-500">{actorLabel[s.from]} → {actorLabel[s.to]}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        {/* stage */}
        <div className="min-w-0 space-y-4 p-5">
          {/* actor lanes */}
          <div className="scrollbar-thin -mx-1 overflow-x-auto px-1 pb-1">
            <div className="flex min-w-max items-center gap-1.5">
              {ACTORS.filter((a) => involved.has(a.id)).map((a) => {
                const isFrom = step.from === a.id
                const isTo = step.to === a.id
                return (
                  <span
                    key={a.id}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all duration-300 ${
                      isTo
                        ? 'bg-brand-600 text-white shadow-glow'
                        : isFrom
                          ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-300 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-400/40'
                          : 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400'
                    }`}
                  >
                    {isTo && <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-white" /><span className="relative h-1.5 w-1.5 rounded-full bg-white" /></span>}
                    {a.label}
                  </span>
                )
              })}
            </div>
          </div>

          <div key={`${scenario}-${index}`} className="animate-fade-in space-y-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
                Step {index + 1} of {steps.length}
                <span className="inline-flex items-center gap-1 font-medium normal-case tracking-normal text-slate-400 dark:text-slate-500">
                  {actorLabel[step.from]} <ArrowRight size={12} /> {actorLabel[step.to]}
                </span>
              </p>
              <h3 className="heading mt-1 text-lg font-semibold tracking-tight">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{step.detail}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <StateTile label="Transaction status" value={step.txn} tone={STATUS_TONE[step.txn]} />
              <StateTile label="Saga status" value={step.saga} tone={SAGA_TONE[step.saga]} sub={`step ${step.step}`} />
            </div>

            {step.rules && (
              <div className="rounded-xl border border-slate-200 p-3.5 dark:border-white/[0.07]">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Risk score</p>
                  <p className="heading tabular text-sm font-bold">{step.score}<span className="muted font-normal"> / 100</span></p>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5" role="img" aria-label={`Risk score ${step.score} of 100`}>
                  <div className={`h-full rounded-full transition-all duration-700 ${step.score >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(step.score, 2)}%` }} />
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
                  {step.rules.length === 0 && <span className="muted">No rule triggered.</span>}
                  {step.rules.map((r) => <Badge key={r.rule} tone={step.score >= 60 ? 'amber' : 'slate'} className="font-mono">{r.rule} +{r.score}</Badge>)}
                  <span className="muted ml-auto">0–59 approve · 60–79 review · 80+ block</span>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Rows written</span>
              {step.tables.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 font-mono text-[10.5px] text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                  <Database size={10} /> {t}
                </span>
              ))}
            </div>

            <Payload step={step} />
          </div>

          {/* controls */}
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 dark:border-white/[0.06]">
            <div className="flex items-center gap-1.5">
              <button type="button" className="btn-icon" onClick={() => { setIndex(0); setPlaying(false) }} aria-label="Reset" title="Reset"><RotateCcw size={16} /></button>
              <button type="button" className="btn-ghost !px-3" onClick={() => { setIndex((i) => Math.max(0, i - 1)); setPlaying(false) }} disabled={index === 0} aria-label="Previous step"><ChevronLeft size={16} /></button>
              <button type="button" className="btn-primary min-w-[104px]" onClick={togglePlay}>
                {playing ? <Pause size={16} /> : <Play size={16} />} {playing ? 'Pause' : index >= last ? 'Replay' : 'Play'}
              </button>
              <button type="button" className="btn-ghost !px-3" onClick={() => { setIndex((i) => Math.min(last, i + 1)); setPlaying(false) }} disabled={index === last} aria-label="Next step"><ChevronRight size={16} /></button>
            </div>
            <div className="flex min-w-[140px] flex-1 items-center gap-1" aria-hidden>
              {steps.map((s, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                    i <= index ? (failedFinal && i === last && index === last ? 'bg-rose-500' : 'bg-brand-500') : 'bg-slate-200 dark:bg-white/10'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
