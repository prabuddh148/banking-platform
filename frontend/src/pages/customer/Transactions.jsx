import { useMemo, useState } from 'react'
import { Search, Download, Receipt } from 'lucide-react'
import { PageHeader, Card, StatusBadge, EmptyState } from '../../components/ui/Primitives.jsx'
import { transactions, accounts } from '../../data/mockData.js'
import { formatSigned, formatDate } from '../../lib/format.js'

const accountName = (id) => accounts.find((a) => a.id === id)?.name || '—'

export default function Transactions() {
  const [query, setQuery] = useState('')
  const [account, setAccount] = useState('all')
  const [type, setType] = useState('all')

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (account !== 'all' && t.accountId !== account) return false
      if (type !== 'all' && t.type !== type) return false
      if (query && !t.description.toLowerCase().includes(query.toLowerCase()) && !t.category.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
  }, [query, account, type])

  const inflow = filtered.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const outflow = filtered.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={`${filtered.length} of ${transactions.length} transactions`}
        action={<button className="btn-ghost"><Download size={16} /> Export CSV</button>}
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search description or category…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="input sm:w-52" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="all">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="input sm:w-40" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            <option value="credit">Money in</option>
            <option value="debit">Money out</option>
          </select>
        </div>
        <div className="mt-3 flex gap-6 text-sm">
          <span className="text-slate-500">In: <span className="font-semibold text-emerald-600">{formatSigned(inflow)}</span></span>
          <span className="text-slate-500">Out: <span className="font-semibold text-slate-800">{formatSigned(-outflow)}</span></span>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3">Description</th>
                <th className="px-5 py-3">Account</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{t.description}</td>
                  <td className="px-5 py-3 text-slate-500">{accountName(t.accountId)}</td>
                  <td className="px-5 py-3 text-slate-500">{t.category}</td>
                  <td className="px-5 py-3 text-slate-500">{formatDate(t.date)}</td>
                  <td className="px-5 py-3"><StatusBadge status={t.status} /></td>
                  <td className={`px-5 py-3 text-right font-semibold ${t.amount > 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                    {formatSigned(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <EmptyState icon={Receipt} title="No transactions found" message="Try adjusting your filters." />}
      </Card>
    </>
  )
}
