import { Link } from 'react-router-dom'
import { Wallet, PiggyBank, CreditCard, TrendingUp, ArrowRight, ArrowLeftRight, Plus } from 'lucide-react'
import { PageHeader, Card, StatCard, Sparkline, CategoryBars, StatusBadge } from '../../components/ui/Primitives.jsx'
import { accounts, transactions, spendingByCategory, balanceTrend, currentUser } from '../../data/mockData.js'
import { formatCurrency, formatSigned, formatDate } from '../../lib/format.js'

const typeIcon = { Checking: Wallet, Savings: PiggyBank, Credit: CreditCard }

export default function Dashboard() {
  const netWorth = accounts.reduce((sum, a) => sum + a.balance, 0)
  const totalSpent = spendingByCategory.reduce((s, c) => s + c.amount, 0)
  const recent = transactions.slice(0, 6)

  return (
    <>
      <PageHeader
        title={`Welcome back, ${currentUser.name.split(' ')[0]}`}
        subtitle="Here's what's happening across your accounts."
        action={
          <Link to="/transfer" className="btn-primary">
            <ArrowLeftRight size={16} /> New transfer
          </Link>
        }
      />

      {/* Top stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Net worth" value={formatCurrency(netWorth)} icon={TrendingUp} tone="brand" delta={{ up: true, label: '2.4% this month' }} />
        <StatCard label="Checking" value={formatCurrency(accounts[0].balance)} icon={Wallet} tone="slate" />
        <StatCard label="Savings" value={formatCurrency(accounts[1].balance)} icon={PiggyBank} tone="green" delta={{ up: true, label: `${accounts[1].apy}% APY` }} />
        <StatCard label="Card balance" value={formatCurrency(Math.abs(accounts[2].balance))} icon={CreditCard} tone="amber" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Balance trend */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Total balance</h2>
              <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(netWorth)}</p>
            </div>
            <span className="text-xs font-medium text-emerald-600">▲ 12-week trend</span>
          </div>
          <div className="mt-4">
            <Sparkline data={balanceTrend} height={120} />
          </div>
        </Card>

        {/* Spending */}
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">Spending this month</h2>
          <p className="text-sm text-slate-500">{formatCurrency(totalSpent)} across {spendingByCategory.length} categories</p>
          <div className="mt-4">
            <CategoryBars items={spendingByCategory} format={formatCurrency} />
          </div>
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
                  <p className="text-xs text-slate-500">{acc.number}</p>
                </div>
                <p className={`text-sm font-bold ${acc.balance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                  {formatCurrency(acc.balance)}
                </p>
              </Link>
            )
          })}
          <Link to="/accounts" className="btn-ghost w-full">
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
          <ul className="divide-y divide-slate-100">
            {recent.map((t) => (
              <li key={t.id} className="flex items-center gap-4 px-5 py-3">
                <div className={`grid h-9 w-9 place-items-center rounded-full text-sm font-bold ${t.amount > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                  {t.amount > 0 ? '↓' : '↑'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{t.description}</p>
                  <p className="text-xs text-slate-500">{t.category} · {formatDate(t.date)}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${t.amount > 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                    {formatSigned(t.amount)}
                  </p>
                  <StatusBadge status={t.status} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
