import { useMemo, useState } from 'react'
import { Search, Receipt, Flag, RefreshCw } from 'lucide-react'
import { PageHeader, Card, StatusBadge, Badge, EmptyState, AsyncView, Spinner } from '../../components/ui/Primitives.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { listAllAccounts } from '../../services/accountService.js'
import { listAllTransactions } from '../../services/transactionService.js'
import { formatCurrency, formatDateTime } from '../../lib/format.js'
import { USE_MOCK } from '../../lib/config.js'

// Transactions that would land in (or came out of) the fraud pipeline.
const isFlagged = (t) =>
  USE_MOCK
    ? t.status === 'Pending' && Math.abs(t.amount) > 500
    : t.rawStatus === 'UNDER_REVIEW' || t.failureCode === 'FRAUD_BLOCKED' || (t.riskScore ?? 0) >= 60

async function load() {
  // Account names are a nice-to-have: if account-service is down, still show transactions.
  const accounts = await listAllAccounts().then((r) => r.items).catch(() => [])
  return listAllTransactions({ accounts })
}

export default function AdminTransactions() {
  const state = useAsync(load, [])

  return (
    <>
      <PageHeader
        title="Transaction Monitor"
        subtitle={state.data ? `Latest ${state.data.items.length} of ${state.data.total} transactions` : 'Live feed of transactions flowing through the platform.'}
        action={
          <button className="btn-ghost" onClick={state.reload} disabled={state.loading}>
            {state.loading ? <Spinner /> : <RefreshCw size={16} />} Refresh
          </button>
        }
      />
      <AsyncView state={state} card loadingLabel="Loading transactions…" errorTitle="Couldn't load transactions">
        {(data) => <TransactionTable transactions={data.items} />}
      </AsyncView>
    </>
  )
}

function TransactionTable({ transactions }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [flaggedOnly, setFlaggedOnly] = useState(false)

  const statuses = useMemo(() => ['all', ...new Set(transactions.map((t) => t.status))], [transactions])

  const rows = useMemo(() => {
    const q = query.toLowerCase()
    return transactions.filter((t) => {
      if (flaggedOnly && !isFlagged(t)) return false
      if (status !== 'all' && t.status !== status) return false
      if (q && ![t.description, t.id, t.reference, t.customer].some((s) => String(s || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [transactions, query, status, flaggedOnly])

  return (
    <>
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search by description, reference, customer…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="input sm:w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
            {statuses.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
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
                <th className="px-5 py-3">Reference</th>
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Description</th>
                <th className="px-5 py-3">Time</th>
                <th className="px-5 py-3">Risk</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((t) => (
                <tr key={t.id} className={`hover:bg-slate-50 ${isFlagged(t) ? 'bg-rose-50/40' : ''}`}>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500" title={t.id}>{t.reference}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{t.customer}</td>
                  <td className="px-5 py-3">
                    <span className="text-slate-700">{t.description}</span>{' '}
                    {isFlagged(t) && <Badge tone="red"><Flag size={11} /> Review</Badge>}
                    <p className="text-xs text-slate-400">{t.category}{t.failureReason ? ` · ${t.failureReason}` : ''}</p>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{formatDateTime(t.date)}</td>
                  <td className="px-5 py-3 text-slate-500">{t.riskScore ?? '—'}</td>
                  <td className="px-5 py-3"><StatusBadge status={t.status} /></td>
                  <td className={`px-5 py-3 text-right font-semibold ${t.type === 'credit' ? 'text-emerald-600' : 'text-slate-800'}`}>
                    {formatCurrency(Math.abs(t.amount), t.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <EmptyState
            icon={Receipt}
            title={transactions.length === 0 ? 'No transactions yet' : 'No transactions'}
            message={transactions.length === 0 ? 'Transactions will appear here as customers move money.' : 'Nothing matches your filters.'}
          />
        )}
      </Card>
    </>
  )
}
