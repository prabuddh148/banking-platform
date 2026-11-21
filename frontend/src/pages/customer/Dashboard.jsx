import { Link } from 'react-router-dom'
import { Wallet, TrendingUp, ArrowRight, ArrowLeftRight, Plus, ArrowDownLeft, ArrowUpRight, Receipt } from 'lucide-react'
import { accountTypeIcon as typeIcon } from '../../lib/accountTypes.js'
import { PageHeader, Card, StatCard, Sparkline, CategoryBars, StatusBadge, AsyncView, EmptyState } from '../../components/ui/Primitives.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { getCustomerOverview } from '../../services/dashboardService.js'
import { formatCurrency, formatTxnAmount, formatDate } from '../../lib/format.js'

export default function Dashboard() {
  const { user } = useAuth()
  const state = useAsync(() => getCustomerOverview(user), [user?.userId])

  return (
    <>
      <PageHeader
        title={`Welcome back, ${(user?.name || '').split(' ')[0]}`}
        subtitle="Here's what's happening across your accounts."
        action={
          <Link to="/transfer" className="btn-primary">
            <ArrowLeftRight size={16} /> New transfer
          </Link>
        }
      />

      <AsyncView state={state} card loadingLabel="Loading your accounts…" errorTitle="Couldn't load your overview">
        {(data) => <Overview data={data} />}
      </AsyncView>
    </>
  )
}

function Overview({ data }) {
  const { accounts, transactions, currency, total, moneyIn, moneyOut, spending, trend } = data
  const fmt = (v) => formatCurrency(v, currency)
  const recent = transactions.slice(0, 6)
  const totalSpent = spending.reduce((s, c) => s + c.amount, 0)

  if (accounts.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Wallet}
          title="You don't have any accounts yet"
          message="Open your first account to start banking with Meridian."
          action={<Link to="/accounts" className="btn-primary"><Plus size={16} /> Open an account</Link>}
        />
      </Card>
    )
  }

  return (
    <>
      {/* Top stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total balance" value={fmt(total)} icon={TrendingUp} tone="brand" />
        <StatCard label="Accounts" value={accounts.length} icon={Wallet} tone="slate" />
        <StatCard label="Money in (30d)" value={fmt(moneyIn)} icon={ArrowDownLeft} tone="green" />
        <StatCard label="Money out (30d)" value={fmt(moneyOut)} icon={ArrowUpRight} tone="amber" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Balance trend */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Total balance</h2>
              <p className="text-2xl font-bold text-slate-900 mt-1">{fmt(total)}</p>
            </div>
            <span className="text-xs font-medium text-slate-500">12-week trend</span>
          </div>
          <div className="mt-4">
            <Sparkline data={trend} height={120} />
          </div>
        </Card>

        {/* Spending */}
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">Spending this month</h2>
          {spending.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No money went out in the last 30 days.</p>
          ) : (
            <>
              <p className="text-sm text-slate-500">{fmt(totalSpent)} across {spending.length} categories</p>
              <div className="mt-4">
                <CategoryBars items={spending} format={fmt} />
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Accounts */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Your accounts</h2>
            <Link to="/accounts" className="text-sm font-medium text-brand-600 hover:text-brand-700">View all</Link>
          </div>
          {accounts.map((acc) => {
            const Icon = typeIcon[acc.type] || Wallet
            return (
              <Link key={acc.id} to="/accounts" className="card flex items-center gap-3 p-4 hover:border-brand-300 transition-colors">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{acc.name}</p>
                  <p className="text-xs text-slate-500">{acc.number}{acc.status !== 'Active' ? ` · ${acc.status}` : ''}</p>
                </div>
                <p className={`text-sm font-bold ${acc.balance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                  {formatCurrency(acc.balance, acc.currency)}
                </p>
              </Link>
            )
          })}
          <Link to="/accounts?open=1" className="btn-ghost w-full">
            <Plus size={16} /> Open new account
          </Link>
        </div>

        {/* Recent activity */}
        <Card className="lg:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 p-5">
            <h2 className="font-semibold text-slate-900">Recent activity</h2>
            <Link to="/transactions" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              See all <ArrowRight size={14} />
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState icon={Receipt} title="No activity yet" message="Transfers and deposits will show up here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((t) => (
                <li key={t.id} className="flex items-center gap-4 px-5 py-3">
                  <div className={`grid h-9 w-9 place-items-center rounded-full text-sm font-bold ${t.type === 'credit' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                    {t.type === 'credit' ? '↓' : t.type === 'internal' ? '⇄' : '↑'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{t.description}</p>
                    <p className="text-xs text-slate-500">{t.category} · {formatDate(t.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${t.type === 'credit' ? 'text-emerald-600' : 'text-slate-800'}`}>
                      {formatTxnAmount(t)}
                    </p>
                    <StatusBadge status={t.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
