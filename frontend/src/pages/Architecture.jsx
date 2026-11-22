import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Boxes, CheckCircle2, Database, FileLock2, Fingerprint, GitBranch, Github, Inbox, KeyRound, Layers, MousePointerClick,
  Radio, Repeat, ScanSearch, Send, ShieldCheck, TestTube2,
} from 'lucide-react'
import { Badge } from '../components/ui/Primitives.jsx'
import SystemDiagram, { NodeDetail, StackedDiagram } from '../components/showcase/SystemDiagram.jsx'
import SagaPlayer from '../components/showcase/SagaPlayer.jsx'
import { GITHUB_URL } from '../components/showcase/archData.js'

const HERO_STATS = [
  { value: '6', label: 'Spring Boot services' },
  { value: '4', label: 'Kafka topics + DLTs' },
  { value: '5', label: 'PostgreSQL databases' },
  { value: '195', label: 'automated tests' },
]

const MAP_FACTS = [
  { icon: Send, title: 'Sync only at the edge', text: 'Services never call each other over HTTP. A slow service cannot take another one down.' },
  { icon: Radio, title: 'Ordered per aggregate', text: 'Events are keyed by transaction or account id, so one transfer\'s events stay in order.' },
  { icon: Database, title: 'One owner per table', text: 'Each database is migrated by Flyway and validated by Hibernate at startup.' },
]

const PATTERNS = [
  {
    icon: Inbox,
    title: 'Transactional outbox',
    where: 'account · transaction',
    problem: 'Saving a row and sending a Kafka message are two systems. One can succeed while the other fails.',
    solution: 'The event is written to outbox_events in the same DB transaction. A relay publishes PENDING rows every 2 s with acks=all, using FOR UPDATE SKIP LOCKED so two instances never send the same row.',
  },
  {
    icon: Repeat,
    title: 'Idempotent consumers + DLT',
    where: 'every consumer',
    problem: 'Kafka delivers at least once, so the same event can arrive twice.',
    solution: 'Each service records what it processed (processed_events, processed_transactions, UNIQUE event_id). Failures retry 3× 1 s apart, then land in <topic>.DLT for replay.',
  },
  {
    icon: KeyRound,
    title: 'JWT at the gateway, re-checked everywhere',
    where: 'gateway + all services',
    problem: 'A gateway-only check trusts anything that reaches a service directly.',
    solution: 'The gateway validates the HS256 token and strips spoofed X-User-* headers. Every service validates the same token again and enforces ownership and @PreAuthorize admin rules.',
  },
  {
    icon: Database,
    title: 'Database per service',
    where: '5 databases',
    problem: 'A shared schema couples deploys and lets services reach into each other\'s data.',
    solution: 'Each service owns its database, migrated by Flyway with ddl-auto: validate. No cross-database foreign keys. Services never call each other over HTTP, only via events.',
  },
  {
    icon: FileLock2,
    title: 'Immutable audit trail',
    where: 'audit-service',
    problem: 'An audit log that can be edited is not evidence.',
    solution: 'Triggers reject UPDATE, DELETE and TRUNCATE on audit_logs. Every event is stored once (UNIQUE event_id) with PII fields masked and a severity derived from the event type.',
  },
  {
    icon: GitBranch,
    title: 'Orchestrated saga with timeouts',
    where: 'transaction-service',
    problem: 'A transfer spans three services, with no distributed transaction to lean on.',
    solution: 'One orchestrator owns every state change. Debit and credit happen atomically in account-service, so nothing needs compensating. A scheduled job fails sagas stuck for 15 minutes.',
  },
]

const REQUEST_CHAIN = [
  { where: 'gateway', name: 'TraceIdPropagationFilter', what: 'Reuse or create X-Trace-Id' },
  { where: 'gateway', name: 'RequestLoggingFilter', what: 'Method, path, status, duration' },
  { where: 'gateway', name: 'JwtAuthenticationFilter', what: 'Validate token, set X-User-Id / X-User-Roles' },
  { where: 'gateway', name: 'Route + circuit breaker', what: 'Forward, or /fallback → 503' },
  { where: 'service', name: 'JwtAuthenticationFilter', what: 'Validate the same token again' },
  { where: 'service', name: 'Controller → Service → Repository', what: 'Ownership check, then PostgreSQL' },
  { where: 'service', name: 'GlobalExceptionHandler', what: 'Every error → ApiResponse JSON' },
]

const FRAUD_RULES = [
  { rule: 'AmountThresholdRule', when: 'Amount above ₹1,00,000 / ₹5,00,000', score: '+40 / +70' },
  { rule: 'VelocityRule', when: 'More than 5 transactions in 10 minutes', score: '+30' },
  { rule: 'GeographicRule', when: 'Client country not in the allowed list (IN)', score: '+25' },
  { rule: 'PatternAnomalyRule', when: '5× the account average, or 00:00 to 05:00 IST', score: '+20 / +10' },
]

const BANDS = [
  { range: '0–59', level: 'LOW / MEDIUM', decision: 'Approve', cls: 'bg-emerald-500', w: 60 },
  { range: '60–79', level: 'HIGH', decision: 'Review', cls: 'bg-amber-500', w: 20 },
  { range: '80–100', level: 'CRITICAL', decision: 'Block', cls: 'bg-rose-500', w: 20 },
]

const TESTS = [
  { module: 'fraud-service', n: 36 },
  { module: 'audit-service', n: 35 },
  { module: 'account-service', n: 34 },
  { module: 'transaction-service', n: 33 },
  { module: 'notification-service', n: 32 },
  { module: 'api-gateway', n: 17 },
  { module: 'common-library', n: 6 },
]

const STACK = [
  { group: 'Backend', items: ['Java 21', 'Spring Boot 3.3', 'Spring Cloud Gateway', 'Spring Security', 'Spring Data JPA', 'MapStruct'] },
  { group: 'Data & messaging', items: ['PostgreSQL 16', 'Flyway', 'Apache Kafka', 'Spring Kafka', 'Redis (optional)'] },
  { group: 'Resilience & ops', items: ['Resilience4j', 'Actuator', 'Micrometer + Prometheus', 'Grafana', 'OpenTelemetry', 'Docker Compose'] },
  { group: 'Frontend', items: ['React 18', 'Vite 5', 'Tailwind CSS 3', 'react-router 6'] },
  { group: 'Testing', items: ['JUnit 5', 'Mockito', 'AssertJ', '@WebMvcTest', 'WebTestClient', 'Embedded PostgreSQL'] },
]

function SectionTitle({ eyebrow, title, subtitle }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">{eyebrow}</p>
      <h2 className="heading mt-1 text-xl font-bold tracking-tight">{title}</h2>
      {subtitle && <p className="muted mt-1 max-w-3xl text-sm">{subtitle}</p>}
    </div>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-violet-600 p-6 text-white shadow-lift sm:p-8 dark:from-brand-900 dark:via-brand-800 dark:to-violet-900 dark:ring-1 dark:ring-white/10">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" aria-hidden />
      <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/20">
            <Layers size={13} /> How it works
          </p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-[32px] sm:leading-tight">An event-driven bank, end to end</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/80 sm:text-[15px]">
            Five Spring Boot microservices behind a JWT gateway, talking only through Kafka. Every money movement is a saga with a transactional
            outbox, a fraud check and an immutable audit trail. Explore the map, then replay a real transfer step by step.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn bg-white text-brand-700 shadow-sm hover:bg-brand-50">
            <Github size={16} /> View source
          </a>
          <Link to="/transfer" className="btn bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/20">
            Try a transfer <ArrowRight size={16} />
          </Link>
        </div>
      </div>
      <dl className="relative mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {HERO_STATS.map((s) => (
          <div key={s.label} className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15 backdrop-blur-sm">
            <dt className="sr-only">{s.label}</dt>
            <dd className="tabular text-2xl font-bold tracking-tight">{s.value}</dd>
            <dd className="text-xs text-white/75">{s.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function SystemMap() {
  const [selected, setSelected] = useState({ type: 'service', id: 'transaction' })
  return (
    <section>
      <SectionTitle
        eyebrow="System map"
        title="Six services, one event bus"
        subtitle="HTTP only flows client → gateway → service. Everything between services is a Kafka event, so any service can be down without losing a transfer."
      />
      <div className="card overflow-hidden">
        <div className="grid xl:grid-cols-[minmax(0,1fr)_310px]">
          <div className="min-w-0 border-b border-slate-100 p-4 dark:border-white/[0.06] sm:p-5 xl:border-b-0 xl:border-r">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="muted flex items-center gap-1.5 text-xs"><MousePointerClick size={14} /> Click a service, the gateway or a topic</p>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-brand-500" /> publishes</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-emerald-500" /> consumes</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-slate-300 dark:bg-white/25" /> HTTP</span>
              </div>
            </div>
            <div className="hidden rounded-2xl bg-slate-50/70 p-3 dark:bg-white/[0.015] lg:block">
              <SystemDiagram selected={selected} onSelect={setSelected} />
            </div>
            <div className="lg:hidden">
              <StackedDiagram selected={selected} onSelect={setSelected} />
            </div>
            <div className="mt-4 hidden gap-3 sm:grid sm:grid-cols-3">
              {MAP_FACTS.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-xl border border-slate-200/80 px-3.5 py-3 dark:border-white/[0.07]">
                  <p className="heading flex items-center gap-2 text-xs font-semibold"><Icon size={14} className="text-brand-600 dark:text-brand-400" /> {title}</p>
                  <p className="muted mt-1 text-xs leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>
          <aside className="min-h-[320px] bg-white dark:bg-ink-900" aria-live="polite">
            <NodeDetail selected={selected} />
          </aside>
        </div>
      </div>
    </section>
  )
}

function Patterns() {
  return (
    <section>
      <SectionTitle eyebrow="Patterns" title="The hard parts, solved deliberately" subtitle="Each one answers a specific failure mode of distributed systems." />
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
        {PATTERNS.map(({ icon: Icon, title, where, problem, solution }) => (
          <article key={title} className="card card-hover flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                <Icon size={19} />
              </div>
              <Badge tone="slate" className="font-mono !text-[10.5px]">{where}</Badge>
            </div>
            <h3 className="heading mt-4 text-[15px] font-semibold">{title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-rose-700/90 dark:text-rose-300/90"><span className="font-semibold">Problem: </span>{problem}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{solution}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function RequestAndFraud() {
  return (
    <section className="grid gap-4 sm:gap-6 lg:grid-cols-2">
      <div className="card p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300"><Send size={18} /></div>
          <div>
            <h2 className="heading text-[15px] font-semibold">Life of one HTTP request</h2>
            <p className="muted mt-0.5 text-xs">Defense in depth: the token is checked twice.</p>
          </div>
        </div>
        <ol className="relative mt-5 space-y-3 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-slate-200 dark:before:bg-white/10">
          {REQUEST_CHAIN.map((r, i) => (
            <li key={`${r.where}-${r.name}`} className="relative flex items-start gap-3">
              <span className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ring-4 ring-white dark:ring-ink-900 ${r.where === 'gateway' ? 'bg-brand-600 text-white' : 'bg-emerald-600 text-white'}`}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="heading font-mono text-xs font-semibold">{r.name}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${r.where === 'gateway' ? 'text-brand-600 dark:text-brand-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{r.where}</span>
                </div>
                <p className="muted text-xs">{r.what}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="card p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300"><ScanSearch size={18} /></div>
          <div>
            <h2 className="heading text-[15px] font-semibold">Rule-based fraud engine</h2>
            <p className="muted mt-0.5 text-xs">Every rule is a Spring bean. Scores add up, capped at 100.</p>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th className="!px-2">Rule</th><th className="!px-2">Triggers when</th><th className="!px-2 text-right">Score</th></tr>
            </thead>
            <tbody>
              {FRAUD_RULES.map((r) => (
                <tr key={r.rule}>
                  <td className="!px-2 font-mono text-xs font-medium text-slate-800 dark:text-slate-100">{r.rule}</td>
                  <td className="!px-2 text-xs text-slate-600 dark:text-slate-300">{r.when}</td>
                  <td className="tabular !px-2 whitespace-nowrap text-right font-mono text-xs font-semibold text-slate-800 dark:text-slate-100">{r.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5">
          <div className="flex h-2.5 overflow-hidden rounded-full" role="img" aria-label="Score bands: 0 to 59 approve, 60 to 79 review, 80 to 100 block">
            {BANDS.map((b) => <span key={b.range} className={b.cls} style={{ width: `${b.w}%` }} />)}
          </div>
          <div className="mt-2 grid grid-cols-[60fr_20fr_20fr] gap-2 text-[11px]">
            {BANDS.map((b) => (
              <div key={b.range} className="min-w-0">
                <p className="heading font-semibold">{b.decision}</p>
                <p className="muted"><span className="tabular font-mono">{b.range}</span><span className="block truncate">{b.level}</span></p>
              </div>
            ))}
          </div>
          <p className="muted mt-3 text-xs">Example: ₹1,50,000 from the US → 40 + 25 = 65 → HIGH → an admin reviews it in the console.</p>
        </div>
      </div>
    </section>
  )
}

function Quality() {
  const max = Math.max(...TESTS.map((t) => t.n))
  return (
    <section className="grid gap-4 sm:gap-6 lg:grid-cols-5">
      <div className="card p-5 lg:col-span-3">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300"><Boxes size={18} /></div>
          <div>
            <h2 className="heading text-[15px] font-semibold">Tech stack</h2>
            <p className="muted mt-0.5 text-xs">Maven multi-module build, one Docker Compose for everything.</p>
          </div>
        </div>
        <div className="mt-4 space-y-3.5">
          {STACK.map((g) => (
            <div key={g.group} className="sm:flex sm:items-start sm:gap-4">
              <p className="mb-1.5 w-32 shrink-0 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 sm:mb-0">{g.group}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((i) => (
                  <span key={i} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">{i}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5 lg:col-span-2">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"><TestTube2 size={18} /></div>
          <div>
            <h2 className="heading text-[15px] font-semibold">Quality</h2>
            <p className="muted mt-0.5 text-xs">Runs with plain <span className="font-mono">mvn verify</span>. No Docker, Kafka or Redis needed.</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[['195', 'tests'], ['7', 'Maven modules'], ['5', 'schema checks']].map(([v, l]) => (
            <div key={l} className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.03]">
              <p className="heading tabular text-xl font-bold tracking-tight">{v}</p>
              <p className="muted text-[11px] leading-tight">{l}</p>
            </div>
          ))}
        </div>
        <ul className="mt-4 space-y-2">
          {TESTS.map((t) => (
            <li key={t.module} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_28px] items-center gap-2 text-xs">
              <span className="truncate font-mono text-slate-600 dark:text-slate-300">{t.module}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                <span className="block h-full rounded-full bg-brand-500 dark:bg-brand-400" style={{ width: `${(t.n / max) * 100}%` }} />
              </span>
              <span className="heading tabular text-right font-semibold">{t.n}</span>
            </li>
          ))}
        </ul>
        <p className="muted mt-4 flex gap-2 text-xs leading-relaxed">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" />
          SchemaValidationTest boots a real embedded PostgreSQL, runs the Flyway migration and lets Hibernate validate every entity.
        </p>
      </div>
    </section>
  )
}

function Cta() {
  return (
    <section className="card relative overflow-hidden p-6 sm:p-8">
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_left,black,transparent_70%)]" aria-hidden />
      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="hidden h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white shadow-glow sm:grid"><Fingerprint size={22} /></div>
          <div>
            <h2 className="heading text-lg font-bold tracking-tight">See it run</h2>
            <p className="muted mt-1 max-w-xl text-sm">
              Send a transfer and watch its status move through the saga, or sign in as admin to review a fraud alert and read the audit trail.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn-ghost"><Github size={16} /> GitHub</a>
          <Link to="/transfer" className="btn-primary"><Radio size={16} /> Try a transfer</Link>
        </div>
      </div>
    </section>
  )
}

export default function Architecture() {
  return (
    <div className="space-y-10">
      <Hero />
      <SystemMap />
      <section>
        <SectionTitle
          eyebrow="Saga walkthrough"
          title="Follow a transfer"
          subtitle="Pick a scenario and press Play. Each step shows the state the orchestrator persists and the exact event it publishes."
        />
        <SagaPlayer />
      </section>
      <Patterns />
      <RequestAndFraud />
      <Quality />
      <Cta />
      <p className="muted flex items-center justify-center gap-1.5 pb-2 text-center text-xs">
        <ShieldCheck size={13} /> Facts on this page come from the project README: services, ports, topics, events and test counts.
      </p>
    </div>
  )
}
