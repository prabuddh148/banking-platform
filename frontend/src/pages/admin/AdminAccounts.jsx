import { useMemo, useState } from 'react'
import { Search, Users, Snowflake, Sun, RefreshCw } from 'lucide-react'
import { PageHeader, Card, StatusBadge, EmptyState, AsyncView, Spinner } from '../../components/ui/Primitives.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { listAllAccounts, freezeAccount, unfreezeAccount } from '../../services/accountService.js'
import { formatCurrency, formatDate } from '../../lib/format.js'
import { shortId } from '../../services/mappers.js'

export default function AdminAccounts() {
  const state = useAsync(() => listAllAccounts(), [])

  return (
    <>
      <PageHeader
        title="Customer Accounts"
        subtitle={state.data ? `${state.data.total} accounts across the platform` : 'All accounts across the platform'}
        action={
          <button className="btn-ghost" onClick={state.reload} disabled={state.loading}>
            {state.loading ? <Spinner /> : <RefreshCw size={16} />} Refresh
          </button>
        }
      />
      <AsyncView state={state} card loadingLabel="Loading accounts…" errorTitle="Couldn't load accounts">
        {(data) => (
          <AccountTable
            accounts={data.items}
            onUpdated={(acc) => state.setData((d) => ({ ...d, items: d.items.map((a) => (a.id === acc.id ? { ...a, ...acc, opened: acc.opened || a.opened } : a)) }))}
          />
        )}
      </AsyncView>
    </>
  )
}

function AccountTable({ accounts, onUpdated }) {
  const { showToast } = useApp()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [pending, setPending] = useState(null) // account id being frozen/unfrozen

  const statuses = useMemo(() => ['all', ...new Set(accounts.map((a) => a.status))], [accounts])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return accounts.filter((a) => {
      if (status !== 'all' && a.status !== status) return false
      if (q && ![a.customer, a.number, a.accountNumber, a.id].some((s) => String(s || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [accounts, query, status])

  async function toggleFreeze(acc) {
    const freezing = acc.status !== 'Frozen'
    const reason = window.prompt(`${freezing ? 'Freeze' : 'Unfreeze'} ${acc.customer}'s account ${acc.number}?\nReason (optional):`, '')
    if (reason === null) return
    setPending(acc.id)
    try {
      const updated = freezing ? await freezeAccount(acc.id, reason) : await unfreezeAccount(acc.id, reason)
      onUpdated(updated)
      showToast(`Account ${acc.number} ${freezing ? 'frozen' : 'unfrozen'}`)
    } catch (err) {
      showToast(err.message || 'Action failed', 'error')
    } finally {
      setPending(null)
    }
  }

  return (
    <>
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
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((a) => {
                const canToggle = a.status === 'Active' || a.status === 'Frozen'
                return (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-800">{a.customer}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500" title={a.id}>{shortId(a.id)}</td>
                    <td className="px-5 py-3 text-slate-600">{a.type}</td>
                    <td className="px-5 py-3 text-slate-500" title={a.accountNumber}>{a.number}</td>
                    <td className="px-5 py-3 text-slate-500">{formatDate(a.opened)}</td>
                    <td className="px-5 py-3"><StatusBadge status={a.status} /></td>
                    <td className={`px-5 py-3 text-right font-semibold ${a.balance < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                      {formatCurrency(a.balance, a.currency)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canToggle && (
                        <button
                          className={`btn px-3 py-1.5 text-xs ${a.status === 'Frozen' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-sky-50 text-sky-700 hover:bg-sky-100'}`}
                          disabled={pending === a.id}
                          onClick={() => toggleFreeze(a)}
                        >
                          {pending === a.id ? <Spinner size={13} /> : a.status === 'Frozen' ? <Sun size={13} /> : <Snowflake size={13} />}
                          {a.status === 'Frozen' ? 'Unfreeze' : 'Freeze'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <EmptyState
            icon={Users}
            title={accounts.length === 0 ? 'No accounts yet' : 'No accounts found'}
            message={accounts.length === 0 ? 'Accounts opened by customers will appear here.' : 'Try a different search or filter.'}
          />
        )}
      </Card>
    </>
  )
}
