import { useMemo, useState } from 'react'
import { Users, Snowflake, Sun, Wallet, Lock, Archive, ChevronRight, Receipt } from 'lucide-react'
import { PageHeader, Card, StatusBadge, EmptyState, ErrorState, LoadingState, Spinner, SearchInput, Segmented, Pagination, Avatar, Drawer, Modal, KeyValue } from '../../components/ui/Primitives.jsx'
import { SortTh, RefreshButton } from '../../components/admin/AdminBits.jsx'
import { useSorted, usePaged } from '../../components/admin/hooks.js'
import { useApp } from '../../context/AppContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { listAllAccounts, freezeAccount, unfreezeAccount } from '../../services/accountService.js'
import { listAccountTransactions, recordAccountStatusChange } from '../../services/adminService.js'
import { formatCurrency, formatCompactCurrency, formatDate, formatDateTime, formatNumber } from '../../lib/format.js'
import { shortId } from '../../services/mappers.js'

const PAGE_SIZE = 8
const REASONS = ['Suspected fraud', 'Customer request', 'KYC review pending', 'Legal / court order']

export default function AdminAccounts() {
  const state = useAsync(() => listAllAccounts(), [])
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="account-service"
        title="Accounts"
        subtitle={state.data ? `${formatNumber(state.data.total)} accounts across the platform. Freezing blocks every debit and credit in the saga.` : 'Every account across the platform.'}
        action={<RefreshButton loading={state.loading} onClick={state.reload} />}
      />
      {state.error ? (
        <Card><ErrorState error={state.error} onRetry={state.reload} title="Couldn't load accounts" /></Card>
      ) : state.data === undefined ? (
        <Card><LoadingState rows={7} label="Loading accounts…" /></Card>
      ) : (
        <AccountsView
          accounts={state.data.items}
          onUpdated={(acc) => state.setData((d) => ({ ...d, items: d.items.map((a) => (a.id === acc.id ? { ...a, ...acc, customer: a.customer, customerId: a.customerId, opened: a.opened } : a)) }))}
        />
      )}
    </div>
  )
}

function AccountsView({ accounts, onUpdated }) {
  const { showToast } = useApp()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('')
  const [detailId, setDetailId] = useState(null)
  const [action, setAction] = useState(null) // account being frozen/unfrozen
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const types = useMemo(() => [...new Set(accounts.map((a) => a.type))], [accounts])
  const count = (s) => accounts.filter((a) => a.status === s).length
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return accounts.filter((a) => {
      if (status !== 'all' && a.status !== status) return false
      if (type && a.type !== type) return false
      if (q && ![a.customer, a.customerId, a.number, a.accountNumber, a.id].some((s) => String(s || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [accounts, query, status, type])
  const { sorted, sort, toggle } = useSorted(filtered, {
    customer: (a) => a.customer, type: (a) => a.type, opened: (a) => (a.opened ? new Date(a.opened).getTime() : null), status: (a) => a.status, balance: (a) => a.balance,
  }, { field: 'balance', dir: 'desc' })
  const { page, setPage, pageCount, pageRows } = usePaged(sorted, PAGE_SIZE, `${query}|${status}|${type}|${sort.field}|${sort.dir}`)

  const total = accounts.filter((a) => a.status !== 'Closed').reduce((s, a) => s + (a.currency === 'INR' ? a.balance : 0), 0)
  const detail = accounts.find((a) => a.id === detailId) || null

  function openAction(acc) {
    setReason('')
    setAction(acc)
  }

  async function confirmAction() {
    const acc = action
    const freezing = acc.status !== 'Frozen'
    setBusy(true)
    try {
      const updated = freezing ? await freezeAccount(acc.id, reason.trim()) : await unfreezeAccount(acc.id, reason.trim())
      onUpdated(updated)
      recordAccountStatusChange(acc, freezing ? 'Frozen' : 'Active', reason.trim())
      showToast({ title: `Account ${acc.number} ${freezing ? 'frozen' : 'unfrozen'}`, description: `ACCOUNT_STATUS_CHANGED published · ${freezing ? 'ACTIVE → FROZEN' : 'FROZEN → ACTIVE'}` })
      setAction(null)
    } catch (err) {
      showToast({ title: 'Action failed', description: err.message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
        <Mini icon={Wallet} label="Total deposits" value={formatCompactCurrency(total, 'INR')} />
        <Mini icon={Users} label="Active" value={formatNumber(count('Active'))} />
        <Mini icon={Lock} label="Frozen" value={formatNumber(count('Frozen'))} />
        <Mini icon={Archive} label="Closed" value={formatNumber(count('Closed'))} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center dark:border-white/[0.06]">
          <SearchInput className="flex-1" value={query} onChange={setQuery} placeholder="Search customer, customer ID or account number…" />
          <div className="flex flex-wrap items-center gap-3">
            <Segmented size="sm" value={status} onChange={setStatus} options={[
              { value: 'all', label: 'All', count: accounts.length },
              { value: 'Active', label: 'Active', count: count('Active') },
              { value: 'Frozen', label: 'Frozen', count: count('Frozen') },
              { value: 'Closed', label: 'Closed', count: count('Closed') },
            ]} />
            <label className="sr-only" htmlFor="acc-type">Account type</label>
            <select id="acc-type" className="input w-auto py-1.5" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {sorted.length === 0 ? (
          <EmptyState icon={Users} title={accounts.length === 0 ? 'No accounts yet' : 'No accounts found'} message={accounts.length === 0 ? 'Accounts opened by customers will appear here.' : 'Try a different search or filter.'} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto scrollbar-thin md:block">
              <table className="table-base">
                <thead>
                  <tr>
                    <SortTh label="Customer" field="customer" sort={sort} onSort={toggle} />
                    <SortTh label="Type" field="type" sort={sort} onSort={toggle} />
                    <th>Account</th>
                    <SortTh label="Opened" field="opened" sort={sort} onSort={toggle} />
                    <SortTh label="Status" field="status" sort={sort} onSort={toggle} />
                    <SortTh label="Balance" field="balance" sort={sort} onSort={toggle} align="right" />
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((a) => (
                    <tr key={a.id} className="cursor-pointer" onClick={() => setDetailId(a.id)}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={a.customer} size={32} />
                          <div className="min-w-0">
                            <p className="heading truncate font-medium">{a.customer}</p>
                            <p className="muted font-mono text-[11px]">{a.customerId || shortId(a.id)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-slate-600 dark:text-slate-300">{a.type}</td>
                      <td className="font-mono text-xs text-slate-600 dark:text-slate-300" title={a.accountNumber}>{a.number}</td>
                      <td className="whitespace-nowrap text-slate-500 dark:text-slate-400">{formatDate(a.opened)}</td>
                      <td><StatusBadge status={a.status} /></td>
                      <td className="heading tabular whitespace-nowrap text-right font-semibold">{formatCurrency(a.balance, a.currency)}</td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <FreezeButton account={a} onClick={() => openAction(a)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-white/[0.05]">
              {pageRows.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setDetailId(a.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                    <Avatar name={a.customer} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="heading truncate text-sm font-medium">{a.customer}</span>
                        <span className="heading tabular text-sm font-semibold">{formatCurrency(a.balance, a.currency)}</span>
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <span className="muted truncate text-xs">{a.type} · <span className="font-mono">{a.number}</span></span>
                        <StatusBadge status={a.status} />
                      </span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-slate-400" />
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} total={sorted.length} pageSize={PAGE_SIZE} />
          </>
        )}
      </Card>

      <AccountDrawer account={detail} onClose={() => setDetailId(null)} onAction={openAction} />

      <Modal
        open={Boolean(action)}
        onClose={() => !busy && setAction(null)}
        title={action?.status === 'Frozen' ? 'Unfreeze account' : 'Freeze account'}
        subtitle={action ? `${action.customer} · ${action.type} ${action.number}` : ''}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAction(null)} disabled={busy}>Cancel</button>
            <button type="button" className={action?.status === 'Frozen' ? 'btn-success' : 'btn-danger'} onClick={confirmAction} disabled={busy}>
              {busy ? <Spinner size={15} /> : action?.status === 'Frozen' ? <Sun size={15} /> : <Snowflake size={15} />}
              {action?.status === 'Frozen' ? 'Unfreeze' : 'Freeze account'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {action?.status === 'Frozen'
            ? 'The account goes back to ACTIVE and can send and receive money again.'
            : 'The account moves to FROZEN. Any balance update for it fails with ACCOUNT_FROZEN until it is unfrozen.'}
        </p>
        <label htmlFor="freeze-reason" className="label mt-4">Reason</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className={`rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${reason === r ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-400/30 dark:bg-brand-500/15 dark:text-brand-200' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5'}`}>{r}</button>
          ))}
        </div>
        <textarea id="freeze-reason" className="input min-h-[80px]" maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in account_status_history and the audit trail" />
      </Modal>
    </>
  )
}

function FreezeButton({ account: a, onClick }) {
  if (a.status !== 'Active' && a.status !== 'Frozen') return <span className="muted text-xs">—</span>
  const frozen = a.status === 'Frozen'
  return (
    <button type="button" onClick={onClick} className={`btn px-3 py-1.5 text-xs ${frozen ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20' : 'bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20'}`}>
      {frozen ? <Sun size={13} /> : <Snowflake size={13} />} {frozen ? 'Unfreeze' : 'Freeze'}
    </button>
  )
}

function AccountDrawer({ account: a, onClose, onAction }) {
  const txns = useAsync(() => (a ? listAccountTransactions(a.id) : Promise.resolve([])), [a?.id])
  return (
    <Drawer
      open={Boolean(a)}
      onClose={onClose}
      title={a?.customer || 'Account'}
      subtitle={a ? `${a.type} account · ${a.number}` : ''}
      footer={a && (a.status === 'Active' || a.status === 'Frozen') && (
        <button type="button" className={a.status === 'Frozen' ? 'btn-success' : 'btn-danger'} onClick={() => onAction(a)}>
          {a.status === 'Frozen' ? <Sun size={15} /> : <Snowflake size={15} />} {a.status === 'Frozen' ? 'Unfreeze account' : 'Freeze account'}
        </button>
      )}
    >
      {a && (
        <div className="space-y-6">
          <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-brand-600 to-violet-600 p-5 text-white shadow-glow">
            <Avatar name={a.customer} size={48} className="ring-2 ring-white/30" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-white/70">Ledger balance</p>
              <p className="tabular truncate text-2xl font-bold tracking-tight">{formatCurrency(a.balance, a.currency)}</p>
              {a.available != null && a.available !== a.balance && <p className="text-xs text-white/70">Available {formatCurrency(a.available, a.currency)}</p>}
            </div>
            <span className="ml-auto"><StatusBadge status={a.status} /></span>
          </div>
          <KeyValue items={[
            { label: 'Account number', value: a.accountNumber || a.number, mono: true, copy: Boolean(a.accountNumber) },
            { label: 'Account ID', value: a.id, mono: true, copy: true },
            a.customerId && { label: 'Customer ID', value: a.customerId, mono: true, copy: true },
            { label: 'Type', value: a.type },
            { label: 'Currency', value: a.currency },
            { label: 'Opened', value: formatDate(a.opened) },
          ]} />
          <div>
            <h3 className="heading mb-2 text-sm font-semibold">Recent transactions</h3>
            {txns.error ? (
              <p className="muted text-sm">Couldn't load transactions: {txns.error.message}</p>
            ) : txns.loading && !txns.data ? (
              <LoadingState rows={3} />
            ) : !txns.data?.length ? (
              <EmptyState icon={Receipt} title="No recent transactions" message="Nothing has touched this account lately." />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {txns.data.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="heading block truncate font-medium">{t.description}</span>
                      <span className="muted text-xs">{formatDateTime(t.date)} · {t.status}</span>
                    </span>
                    <span className={`tabular shrink-0 font-semibold ${t.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                      {t.amount > 0 ? '+' : '−'}{formatCurrency(Math.abs(t.amount), t.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}

function Mini({ icon: Icon, label, value }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between"><p className="muted text-xs font-medium">{label}</p><Icon size={16} className="text-slate-400" /></div>
      <p className="heading tabular mt-1 text-2xl font-bold">{value}</p>
    </Card>
  )
}
