import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Wallet, ArrowRight, Plus, ArrowDownLeft, ArrowUpRight, Eye, EyeOff, Send, PlusCircle, FileText,
  PiggyBank, Sparkles, TrendingDown, TrendingUp, Lightbulb, Receipt,
} from 'lucide-react'
import { Card, CardHeader, StatCard, EmptyState, ErrorState, Skeleton } from '../../components/ui/Primitives.jsx'
import { ColumnChart, DonutChart, AreaChart, Sparkline } from '../../components/ui/Charts.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { getCustomerOverview } from '../../services/dashboardService.js'
import { formatCurrency, formatCompactCurrency, formatTime, greeting, currencySymbol } from '../../lib/format.js'
import { accountTypeIcon } from '../../lib/accountTypes.js'
import VirtualCard from '../../components/customer/VirtualCard.jsx'
import AddMoneyModal from '../../components/customer/AddMoneyModal.jsx'
import TransactionDrawer from '../../components/customer/TransactionDrawer.jsx'
import { TxnIcon, TxnAmount, ChannelBadge, TxnStatusPill, dayLabel, categoryMeta } from '../../components/customer/TxnBits.jsx'

const HIDE_KEY = 'meridian.hideBalance'
const readHidden = () => { try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false } }

export default function Dashboard() {
  const { user } = useAuth()
  const state = useAsync(() => getCustomerOverview(user), [user?.userId])
  const first = (user?.name || '').split(' ')[0]
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">{today}</p>
          <h1 className="heading text-2xl font-bold tracking-tight sm:text-[26px]">{greeting()}{first ? `, ${first}` : ''}</h1>
          <p className="muted mt-1 text-sm">Here's where your money stands this month.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/transactions" className="btn-ghost hidden sm:inline-flex"><FileText size={16} /> Statements</Link>
          <Link to="/transfer" className="btn-primary"><Send size={16} /> Send money</Link>
        </div>
      </div>

      {state.error ? (
        <Card><ErrorState error={state.error} onRetry={state.reload} title="Couldn't load your overview" /></Card>
      ) : state.data === undefined ? (
        <DashboardSkeleton />
      ) : (
        <Overview data={state.data} user={user} reload={state.reload} />
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading your overview">
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <Skeleton className="h-[260px] rounded-2xl lg:col-span-2" />
        <Skeleton className="h-[260px] rounded-2xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[136px] rounded-2xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <Skeleton className="h-[320px] rounded-2xl lg:col-span-2" />
        <Skeleton className="h-[320px] rounded-2xl" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  )
}

const signedPct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

function Overview({ data, user, reload }) {
  const { accounts, transactions, currency, total, balanceChange, moneyIn, moneyOut, savingsRate, deltas, spending, cashflow, trend, insights, dailyIn, dailyOut } = data
  const [hidden, setHidden] = useState(readHidden)
  const [addMoney, setAddMoney] = useState(false)
  const [selected, setSelected] = useState(null)
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const compact = (v) => formatCompactCurrency(v, currency)
  const money = (v) => formatCurrency(v, currency)

  const toggleHidden = () => setHidden((h) => {
    try { localStorage.setItem(HIDE_KEY, h ? '0' : '1') } catch { /* private mode */ }
    return !h
  })

  if (accounts.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Wallet}
          title="You don't have any accounts yet"
          message="Open your first account to start banking with Meridian."
          action={<Link to="/accounts?open=1" className="btn-primary"><Plus size={16} /> Open an account</Link>}
        />
      </Card>
    )
  }

  const mainAccount = accounts.find((a) => a.type === 'Current' && a.status === 'Active') || accounts.find((a) => a.type !== 'Fixed Deposit') || accounts[0]
  const recent = transactions.slice(0, 7)
  const spendTotal = spending.reduce((s, c) => s + c.amount, 0)
  const up = balanceChange.amount >= 0
  const mask = `${currencySymbol(currency)} ••••••`

  return (
    <>
      {/* ---------------------------------------------------------- hero row */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <section className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-violet-800 p-5 text-white shadow-glow sm:p-6 lg:col-span-2" aria-label="Total balance">
          <div className="absolute -right-24 -top-24 -z-10 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
          <div className="absolute -bottom-32 left-1/3 -z-10 h-72 w-72 rounded-full bg-fuchsia-400/20 blur-3xl" aria-hidden />
          <div className="bg-grid absolute inset-0 -z-10 opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden />

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-white/75">
                Total balance
                <button type="button" onClick={toggleHidden} className="grid h-7 w-7 place-items-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white" aria-label={hidden ? 'Show balance' : 'Hide balance'} aria-pressed={hidden}>
                  {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="tabular mt-1 text-[34px] font-bold leading-tight tracking-tight sm:text-[42px]">{hidden ? mask : money(total)}</p>
              {balanceChange.pct !== null && (
                <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 text-sm text-white/80">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${up ? 'bg-emerald-400/20 text-emerald-100' : 'bg-rose-400/20 text-rose-100'}`}>
                    {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {hidden ? signedPct(balanceChange.pct) : `${up ? '+' : '−'}${compact(Math.abs(balanceChange.amount))} (${signedPct(balanceChange.pct)})`}
                  </span>
                  vs 30 days ago
                </p>
              )}
            </div>
            <div className="hidden w-40 shrink-0 sm:block" aria-hidden>
              <Sparkline data={trend.map((p) => p.value)} height={56} color="rgba(255,255,255,0.9)" />
              <p className="mt-1 text-right text-[11px] text-white/60">12-week trend</p>
            </div>
          </div>

          {/* per-account split */}
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {accounts.slice(0, 3).map((a) => {
              const Icon = accountTypeIcon[a.type] || Wallet
              return (
                <Link key={a.id} to="/accounts" className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-white/15">
                  <Icon size={16} className="shrink-0 text-white/80" />
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-white/70">{a.name} · {a.number.replace('**** ', '•')}</p>
                    <p className="tabular text-sm font-semibold">{hidden ? '••••' : compact(a.balance)}</p>
                  </div>
                </Link>
              )
            })}
          </div>

          {/* quick actions */}
          <div className="mt-5 grid grid-cols-4 gap-2 border-t border-white/10 pt-5">
            <QuickAction to="/transfer" icon={Send} label="Send money" />
            <QuickAction onClick={() => setAddMoney(true)} icon={PlusCircle} label="Add money" />
            <QuickAction to="/accounts?open=1" icon={Plus} label="Open account" />
            <QuickAction to="/transactions" icon={FileText} label="Statements" />
          </div>
        </section>

        <section className="card flex flex-col p-5" aria-label="Virtual debit card">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="heading text-[15px] font-semibold">Your card</h2>
              <p className="muted text-xs">Linked to {mainAccount.name} {mainAccount.number}</p>
            </div>
            <Link to="/accounts" className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">Manage</Link>
          </div>
          <div className="mx-auto w-full max-w-sm lg:max-w-none"><VirtualCard account={mainAccount} holder={user?.name} frozen={mainAccount.status === 'Frozen'} /></div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.04]">
              <p className="muted text-[11px] font-medium">Available</p>
              <p className="heading tabular font-semibold">{hidden ? '••••' : compact(mainAccount.available)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.04]">
              <p className="muted text-[11px] font-medium">Spent this month</p>
              <p className="heading tabular font-semibold">{hidden ? '••••' : compact(moneyOut)}</p>
            </div>
          </div>
        </section>
      </div>

      {/* ---------------------------------------------------------- KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
        <StatCard
          label="Money in · this month"
          value={money(moneyIn)}
          icon={ArrowDownLeft}
          tone="green"
          delta={deltas.moneyIn !== null ? { up: deltas.moneyIn >= 0, good: deltas.moneyIn >= 0, label: `${signedPct(deltas.moneyIn)} vs last month` } : undefined}
          footer={<Sparkline data={dailyIn} height={32} color="var(--series-3)" />}
        />
        <StatCard
          label="Money out · this month"
          value={money(moneyOut)}
          icon={ArrowUpRight}
          tone="red"
          delta={deltas.moneyOut !== null ? { up: deltas.moneyOut >= 0, good: deltas.moneyOut <= 0, label: `${signedPct(deltas.moneyOut)} vs last month` } : undefined}
          footer={<Sparkline data={dailyOut} height={32} color="var(--series-2)" />}
        />
        <StatCard
          label="Savings rate"
          value={savingsRate === null ? '—' : `${Math.round(savingsRate)}%`}
          icon={PiggyBank}
          tone="brand"
          delta={deltas.savingsRate !== null ? { up: deltas.savingsRate >= 0, good: deltas.savingsRate >= 0, label: `${deltas.savingsRate > 0 ? '+' : ''}${deltas.savingsRate.toFixed(0)} pts vs last month` } : undefined}
          footer={<SavingsBar rate={savingsRate} />}
        />
      </div>

      {/* ---------------------------------------------------------- charts */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Cashflow" subtitle={`Income vs spending, last ${cashflow.length} months (own-account moves excluded)`} />
          <div className="p-5 pt-4">
            <ColumnChart
              height={240}
              labels={cashflow.map((m) => (m.partial ? `${m.label} (MTD)` : m.label))}
              series={[
                { name: 'Income', values: cashflow.map((m) => m.income) },
                { name: 'Spending', values: cashflow.map((m) => m.spending) },
              ]}
              format={money}
              axisFormat={compact}
            />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Spending by category" subtitle="This month" />
          <div className="p-5 pt-4">
            {spending.length === 0 ? (
              <EmptyState icon={Receipt} title="No spending yet" message="Nothing has gone out this month." />
            ) : (
              <DonutChart
                items={spending.map((c) => ({ label: c.category, value: c.amount }))}
                format={compact}
                centerLabel="Spent"
                centerValue={compact(spendTotal)}
                size={160}
              />
            )}
          </div>
        </Card>
      </div>

      {/* ---------------------------------------------------------- activity + trend */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader
            title="Recent transactions"
            subtitle={`${transactions.length} in the last 90 days`}
            action={<Link to="/transactions" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">View all <ArrowRight size={14} /></Link>}
          />
          {recent.length === 0 ? (
            <EmptyState icon={Receipt} title="No activity yet" message="Transfers and deposits will show up here." action={<Link to="/transfer" className="btn-primary"><Send size={16} /> Send money</Link>} />
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/[0.05]">
              {recent.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setSelected(t)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                    <TxnIcon txn={t} size={38} />
                    <div className="min-w-0 flex-1">
                      <p className="heading truncate text-sm font-medium">{t.description}</p>
                      <p className="muted mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                        <span>{t.category}</span>
                        <span aria-hidden>·</span>
                        <span>{dayLabel(t.date)}, {formatTime(t.date)}</span>
                      </p>
                    </div>
                    <div className="hidden sm:block"><ChannelBadge txn={t} /></div>
                    <div className="flex flex-col items-end gap-1">
                      <TxnAmount txn={t} className="text-sm" />
                      <TxnStatusPill txn={t} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4 sm:space-y-6">
          <Card>
            <CardHeader title="Balance trend" subtitle="Total across accounts, last 12 weeks" />
            <div className="p-5 pt-3">
              <AreaChart
                zeroBased={false}
                height={150}
                labels={trend.map((p) => p.label)}
                series={[{ name: 'Total balance', values: trend.map((p) => p.value) }]}
                format={money}
                axisFormat={compact}
              />
            </div>
          </Card>
          <InsightsCard insights={insights} />
        </div>
      </div>

      <AddMoneyModal open={addMoney} accounts={accounts} onClose={() => setAddMoney(false)} onDone={() => setTimeout(reload, 800)} />
      {selected && <TransactionDrawer txn={selected} accountById={accountById} onClose={() => setSelected(null)} />}
    </>
  )
}

function QuickAction({ to, onClick, icon: Icon, label }) {
  const cls = 'group flex flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-center text-[11px] font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white sm:text-xs'
  const inner = (
    <>
      <span className="grid h-10 w-10 place-items-center rounded-full bg-white/15 ring-1 ring-white/20 transition-transform group-hover:scale-105"><Icon size={18} /></span>
      {label}
    </>
  )
  return to ? <Link to={to} className={cls}>{inner}</Link> : <button type="button" onClick={onClick} className={cls}>{inner}</button>
}

function SavingsBar({ rate }) {
  if (rate === null) return null
  const w = Math.max(0, Math.min(100, rate))
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${w}%` }} />
      </div>
      <p className="muted mt-1.5 text-[11px]">Share of this month's income you kept. 20%+ is healthy.</p>
    </div>
  )
}

function InsightsCard({ insights }) {
  const tone = {
    good: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    warn: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  }
  return (
    <Card>
      <CardHeader title="Insights" subtitle="Computed from your transactions" icon={Sparkles} />
      {insights.length === 0 ? (
        <p className="muted px-5 pb-5 pt-3 text-sm">Not enough activity yet. Check back after a few transactions.</p>
      ) : (
        <ul className="space-y-3 p-5 pt-4">
          {insights.slice(0, 3).map((ins) => {
            const meta = categoryMeta(ins.category)
            const Icon = ins.kind === 'good' ? TrendingDown : ins.kind === 'warn' ? TrendingUp : meta.icon || Lightbulb
            return (
              <li key={ins.title} className="flex gap-3">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone[ins.kind] || meta.tone}`}><Icon size={15} /></span>
                <div className="min-w-0">
                  <p className="heading text-sm font-medium leading-snug">{ins.title}</p>
                  <p className="muted mt-0.5 text-xs leading-relaxed">{ins.detail}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
