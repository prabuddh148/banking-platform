import { useMemo, useState } from 'react'
import { Search, Receipt, Flag } from 'lucide-react'
import { PageHeader, Card, StatusBadge, Badge, EmptyState } from '../../components/ui/Primitives.jsx'
import { transactions, accounts } from '../../data/mockData.js'
import { formatSigned, formatDate, formatTime } from '../../lib/format.js'

// Present the transaction feed with an operations lens: account owner + a
// flag on the higher-value / pending items that would hit the fraud pipeline.
const owner = (id) => accounts.find((a) => a.id === id)?.name || '—'
const isFlagged = (t) => t.status === 'Pending' && Math.abs(t.amount) > 500

export default function AdminTransactions() {
  const [query, setQuery] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)

  const rows = useMemo(() => {
    return transactions.filter((t) => {
      if (flaggedOnly && !isFlagged(t)) return false
      if (query) {
        const q = query.toLowerCase()
        if (!t.description.toLowerCase().includes(q) && !t.id.includes(q)) return false
      }
      return true
    })
  }, [query, flaggedOnly])

  return (
    <>
      <PageHeader title="Transaction Monitor" subtitle="Live feed of transactions flowing through the platform." />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search by description or txn ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600 select-none">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
            Flagged only
          </label>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3">Txn ID</th>
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Description</th>
                <th className="px-5 py-3">Time</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((t) => (
                <tr key={t.id} className={`hover:bg-slate-50 ${isFlagged(t) ? 'bg-rose-50/40' : ''}`}>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{t.id}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{owner(t.accountId)}</td>
                  <td className="px-5 py-3">
                    <span className="text-slate-700">{t.description}</span>
                    {isFlagged(t) && <Badge tone="red"><Flag size={11} /> Review</Badge>}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{formatDate(t.date, { month: 'short', day: 'numeric' })}, {formatTime(t.date + 'T09:30')}</td>
                  <td className="px-5 py-3"><StatusBadge status={t.status} /></td>
                  <td className={`px-5 py-3 text-right font-semibold ${t.amount > 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                    {formatSigned(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <EmptyState icon={Receipt} title="No transactions" message="Nothing matches your filters." />}
      </Card>
    </>
  )
}
