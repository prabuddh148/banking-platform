import { useMemo, useState } from 'react'
import { Search, Users } from 'lucide-react'
import { PageHeader, Card, StatusBadge, EmptyState } from '../../components/ui/Primitives.jsx'
import { adminAccounts } from '../../data/mockData.js'
import { formatCurrency, formatDate } from '../../lib/format.js'

export default function AdminAccounts() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')

  const filtered = useMemo(() => {
    return adminAccounts.filter((a) => {
      if (status !== 'all' && a.status !== status) return false
      if (query) {
        const q = query.toLowerCase()
        if (!a.customer.toLowerCase().includes(q) && !a.number.includes(q) && !a.id.includes(q)) return false
      }
      return true
    })
  }, [query, status])

  const statuses = ['all', 'Active', 'Frozen', 'Under Review', 'Dormant']

  return (
    <>
      <PageHeader title="Customer Accounts" subtitle={`${adminAccounts.length} accounts across the platform`} />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search by customer, account #, or ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="input sm:w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            {statuses.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Account ID</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Number</th>
                <th className="px-5 py-3">Opened</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{a.customer}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{a.id}</td>
                  <td className="px-5 py-3 text-slate-600">{a.type}</td>
                  <td className="px-5 py-3 text-slate-500">{a.number}</td>
                  <td className="px-5 py-3 text-slate-500">{formatDate(a.opened)}</td>
                  <td className="px-5 py-3"><StatusBadge status={a.status} /></td>
                  <td className={`px-5 py-3 text-right font-semibold ${a.balance < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                    {formatCurrency(a.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <EmptyState icon={Users} title="No accounts found" message="Try a different search or filter." />}
      </Card>
    </>
  )
}
