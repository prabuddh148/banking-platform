import { Wallet, PiggyBank, CreditCard, Snowflake, Send, FileText } from 'lucide-react'
import { PageHeader, Card, StatusBadge } from '../../components/ui/Primitives.jsx'
import { accounts } from '../../data/mockData.js'
import { formatCurrency } from '../../lib/format.js'

const typeIcon = { Checking: Wallet, Savings: PiggyBank, Credit: CreditCard }

export default function Accounts() {
  return (
    <>
      <PageHeader title="Accounts" subtitle="All of your Meridian accounts in one place." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {accounts.map((acc) => {
          const Icon = typeIcon[acc.type] || Wallet
          const isCredit = acc.type === 'Credit'
          const utilization = isCredit ? Math.abs(acc.balance) / acc.limit : null
          return (
            <Card key={acc.id} className="overflow-hidden">
              <div className="flex items-start justify-between gap-4 p-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
                    <Icon size={22} />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{acc.name}</p>
                    <p className="text-sm text-slate-500">{acc.type} · {acc.number}</p>
                  </div>
                </div>
                <StatusBadge status={acc.status} />
              </div>

              <div className="grid grid-cols-2 gap-px bg-slate-100">
                <div className="bg-white p-5">
                  <p className="text-xs font-medium text-slate-500">{isCredit ? 'Current balance' : 'Balance'}</p>
                  <p className={`mt-1 text-xl font-bold ${acc.balance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                    {formatCurrency(acc.balance)}
                  </p>
                </div>
                <div className="bg-white p-5">
                  <p className="text-xs font-medium text-slate-500">{isCredit ? 'Available credit' : 'Available'}</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{formatCurrency(acc.available)}</p>
                </div>
              </div>

              {isCredit && (
                <div className="px-5 pb-1">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Credit utilization</span>
                    <span className="font-medium text-slate-700">{Math.round(utilization * 100)}% of {formatCurrency(acc.limit)}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-slate-100">
                    <div className={`h-2 rounded-full ${utilization > 0.3 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${utilization * 100}%` }} />
                  </div>
                </div>
              )}

              {acc.apy && (
                <div className="px-5 py-2 text-xs text-emerald-700 bg-emerald-50/50">
                  Earning <span className="font-semibold">{acc.apy}% APY</span> — accrued monthly.
                </div>
              )}

              <div className="flex gap-2 border-t border-slate-100 p-4">
                <button className="btn-ghost flex-1"><Send size={15} /> Transfer</button>
                <button className="btn-ghost flex-1"><FileText size={15} /> Statements</button>
                <button className="btn-ghost"><Snowflake size={15} /></button>
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}
