import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, FileLock2, Github, KeyRound, Landmark, ScanSearch, TestTube2, Workflow } from 'lucide-react'
import { GITHUB_URL } from './archData.js'

const HIGHLIGHTS = [
  { icon: Workflow, title: 'Saga-orchestrated transfers', text: 'with a transactional outbox and idempotent Kafka consumers' },
  { icon: ScanSearch, title: 'Rule-based fraud engine', text: 'risky payments wait for a human review in the ops console' },
  { icon: FileLock2, title: 'Immutable audit trail', text: 'database triggers reject every UPDATE and DELETE' },
  { icon: KeyRound, title: 'JWT gateway', text: 'and every service re-validates the token (defense in depth)' },
  { icon: TestTube2, title: '193 automated tests', text: 'incl. schema validation on embedded PostgreSQL' },
]

const STACK = ['Java 21', 'Spring Boot 3', 'Kafka', 'PostgreSQL', 'Docker', 'React']

const EVENTS = [
  { type: 'INITIATED', meta: 'transaction', t: '0 ms' },
  { type: 'FRAUD_CLEARED', meta: 'fraud · score 0', t: '184 ms' },
  { type: 'BALANCE_UPDATED', meta: 'account · atomic', t: '2.1 s' },
  { type: 'COMPLETED', meta: 'saga closed', t: '2.3 s' },
]

/** Decorative "live saga" strip: one transfer's events flowing through Kafka. */
function SagaStrip() {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 backdrop-blur-sm" aria-hidden>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate text-slate-300">
          Transfer <span className="tabular font-semibold text-white">₹1,500</span> · Rahul → Priya
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-semibold text-emerald-300">
          <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-emerald-400" /><span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>
          COMPLETED in 2.3 s
        </span>
      </div>
      <ol className="mt-3.5 flex items-start">
        {EVENTS.map((e, i) => (
          <li key={e.type} className={`flex min-w-0 items-start ${i < EVENTS.length - 1 ? 'flex-1' : ''}`}>
            <div
              className="flex min-w-0 flex-col items-center text-center animate-fade-in [animation-fill-mode:both]"
              style={{ animationDelay: `${250 + i * 400}ms`, animationDuration: '450ms', flex: '0 0 auto', width: 96 }}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-400/15 ring-1 ring-emerald-400/40">
                <CheckCircle2 size={14} className="text-emerald-300" />
              </span>
              <span className="mt-1.5 max-w-full truncate font-mono text-[10px] font-medium text-slate-100">{e.type}</span>
              <span className="max-w-full truncate text-[10px] text-slate-400">{e.meta}</span>
              <span className="tabular font-mono text-[9.5px] text-slate-500">{e.t}</span>
            </div>
            {i < EVENTS.length - 1 && (
              <svg className="mt-3 h-2 min-w-0 flex-1" preserveAspectRatio="none" viewBox="0 0 100 8">
                <line x1="0" y1="4" x2="100" y2="4" strokeDasharray="4 4" strokeWidth="1.5" className="animate-flow stroke-brand-300/70" vectorEffect="non-scaling-stroke" />
              </svg>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function LoginHero() {
  return (
    <section className="relative isolate overflow-hidden bg-[#0a0b1e] text-white lg:flex lg:w-[54%] lg:flex-col">
      {/* backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-600/40 blur-[110px]" />
        <div className="absolute -bottom-40 right-0 h-[26rem] w-[26rem] rounded-full bg-violet-600/30 blur-[120px]" />
        <div className="bg-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_30%_20%,black,transparent_75%)]" />
      </div>

      <div className="flex flex-1 flex-col px-6 py-8 sm:px-10 lg:px-14 lg:py-10">
        <div className="hidden items-center gap-2.5 lg:flex">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-brand-600 shadow-glow"><Landmark size={19} /></div>
          <span className="text-lg font-bold tracking-tight">Meridian</span>
        </div>

        <div className="flex flex-1 flex-col justify-center py-2 lg:py-8">
          <div className="max-w-xl">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-1 text-xs font-medium text-brand-100 ring-1 ring-white/15">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Portfolio project · live demo
            </p>
            <h2 className="mt-4 text-3xl font-bold leading-[1.12] tracking-tight sm:text-4xl xl:text-[42px]">
              Banking, built the way{' '}
              <span className="bg-gradient-to-r from-brand-200 via-violet-200 to-sky-200 bg-clip-text text-transparent">production systems</span> are.
            </h2>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-slate-300">
              Event-driven banking platform built with Spring Boot microservices, Kafka and React.
            </p>

            <ul className="mt-6 space-y-2.5">
              {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-brand-200 ring-1 ring-white/10"><Icon size={15} /></span>
                  <p className="text-[13.5px] leading-relaxed text-slate-300"><span className="font-semibold text-white">{title}</span> {text}</p>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-wrap gap-1.5">
              {STACK.map((s) => (
                <span key={s} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-slate-200 ring-1 ring-white/10">{s}</span>
              ))}
            </div>

            <div className="mt-7 flex flex-wrap gap-2.5">
              <Link to="/login?demo=rahul&next=/architecture" className="btn bg-white text-slate-900 shadow-sm hover:bg-brand-50 focus-visible:ring-offset-[#0a0b1e]">
                How it works <ArrowRight size={16} />
              </Link>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn bg-white/[0.06] text-white ring-1 ring-white/15 hover:bg-white/[0.12] focus-visible:ring-offset-[#0a0b1e]">
                <Github size={16} /> View source on GitHub
              </a>
            </div>
          </div>

          <div className="mt-8 max-w-xl">
            <SagaStrip />
          </div>
        </div>
      </div>
    </section>
  )
}
