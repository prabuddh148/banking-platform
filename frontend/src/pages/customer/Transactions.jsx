import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Download, Receipt, RefreshCw } from 'lucide-react'
import { PageHeader, Card, StatusBadge, EmptyState, AsyncView, Spinner } from '../../components/ui/Primitives.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { listMyAccounts } from '../../services/accountService.js'
import { listMyTransactions } from '../../services/transactionService.js'
import { formatSigned, formatTxnAmount, formatDate } from '../../lib/format.js'
import { DEFAULT_CURRENCY } from '../../lib/config.js'

async function loadData(user) {
  const accounts = await listMyAccounts(user)
  const transactions = await listMyTransactions(accounts)
  return { accounts, transactions }
}

function downloadCsv(rows, accountName) {
  const header = ['Date', 'Reference', 'Description', 'Account', 'Category', 'Status', 'Amount', 'Currency']
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = rows.map((t) =>
    [t.date, t.reference, t.description, accountName(t), t.category, t.status, t.amount, t.currency].map(escape).join(','),
  )
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'transactions.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function Transactions() {
  const { user } = useAuth()
  const state = useAsync(() => loadData(user), [user?.userId])

  return (
    <>
      {(state.data === undefined || state.error) && <PageHeader title="Transactions" subtitle="Your account activity." />}
      <AsyncView state={state} loadingLabel="Loading transactions…" errorTitle="Couldn't load transactions" card>
        {(data) => <TransactionList data={data} reload={state.reload} reloading={state.loading} />}
      </AsyncView>
    </>
  )
}

function TransactionList({ data, reload, reloading }) {
  const { accounts, transactions } = data
  const [params] = useSearchParams()
  const [query, setQuery] = useState('')
  const [account, setAccount] = useState(params.get('account') || 'all')
  const [type, setType] = useState('all')

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const accountName = (t) => {
    const ids = account !== 'all' ? [account] : t.accountIds
    const names = ids.map((id) => accountById.get(id)).filter(Boolean).map((a) => `${a.name} (${a.number})`)
    return names.join(' → ') || '—'
  }

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return transactions.filter((t) => {
      if (account !== 'all' && !t.accountIds.includes(account)) return false
      if (type !== 'all' && t.type !== type) return false
      if (q && ![t.description, t.category, t.reference].some((s) => String(s || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [transactions, query, account, type])

  const currency = accounts[0]?.currency || filtered[0]?.currency || DEFAULT_CURRENCY
  const counted = filtered.filter((t) => t.rawStatus !== 'FAILED')
  const inflow = counted.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
  const outflow = counted.filter((t) => t.type === 'debit').reduce((s, t) => s + Math.abs(t.amount), 0)

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={`${filtered.length} of ${transactions.length} transactions`}
        action={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={reload} disabled={reloading}>
              {reloading ? <Spinner /> : <RefreshCw size={16} />} Refresh
            </button>
            <button className="btn-ghost" onClick={() => downloadCsv(filtered, accountName)} disabled={filtered.length === 0}>
              <Download size={16} /> Export CSV
            </button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search description, category or reference…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="input sm:w-56" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="all">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.number})</option>)}
          </select>
          <select className="input sm:w-48" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            <option value="credit">Money in</option>
            <option value="debit">Money out</option>
            <option value="internal">Between my accounts</option>
          </select>
        </div>
        <div className="mt-3 flex gap-6 text-sm">
          <span className="text-slate-500">In: <span className="font-semibold text-emerald-600">{formatSigned(inflow, currency)}</span></span>
          <span className="text-slate-500">Out: <span className="font-semibold text-slate-800">{formatSigned(-outflow, currency)}</span></span>
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
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{t.description}</p>
                    {t.reference && t.reference !== t.id && <p className="font-mono text-[11px] text-slate-400">{t.reference}</p>}
                    {t.failureReason && <p className="text-xs text-rose-600">{t.failureReason}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{accountName(t)}</td>
                  <td className="px-5 py-3 text-slate-500">{t.category}</td>
                  <td className="px-5 py-3 text-slate-500">{formatDate(t.date)}</td>
                  <td className="px-5 py-3"><StatusBadge status={t.status} /></td>
                  <td className={`px-5 py-3 text-right font-semibold ${t.type === 'credit' ? 'text-emerald-600' : 'text-slate-800'} ${t.rawStatus === 'FAILED' ? 'line-through opacity-60' : ''}`}>
                    {formatTxnAmount(t)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <EmptyState
            icon={Receipt}
            title={transactions.length === 0 ? 'No transactions yet' : 'No transactions found'}
            message={transactions.length === 0 ? 'Your transfers, deposits and withdrawals will appear here.' : 'Try adjusting your filters.'}
          />
        )}
      </Card>
    </>
  )
}
