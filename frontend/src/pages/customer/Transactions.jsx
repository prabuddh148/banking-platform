import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Download, Receipt, RefreshCw, ArrowDownLeft, ArrowUpRight, Scale, SlidersHorizontal, X, Send } from 'lucide-react'
import { PageHeader, Card, EmptyState, ErrorState, Spinner, SearchInput, Segmented, LoadingState, Skeleton } from '../../components/ui/Primitives.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { listMyAccounts } from '../../services/accountService.js'
import { listMyTransactions } from '../../services/transactionService.js'
import { txnStatusKey, txnChannel, isFailedTxn } from '../../services/mappers.js'
import { formatSigned, formatTime } from '../../lib/format.js'
import { DEFAULT_CURRENCY } from '../../lib/config.js'
import TransactionDrawer from '../../components/customer/TransactionDrawer.jsx'
import { TxnIcon, TxnAmount, ChannelBadge, TxnStatusPill, groupByDay } from '../../components/customer/TxnBits.jsx'

const PAGE = 40
const DAY = 86400000

async function loadData(user) {
  const accounts = await listMyAccounts(user)
  const transactions = await listMyTransactions(accounts)
  return { accounts, transactions }
}

function downloadCsv(rows, accountName) {
  const header = ['Date', 'Reference', 'Description', 'Account', 'Category', 'Channel', 'Status', 'Amount', 'Currency']
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = rows.map((t) =>
    [t.date, t.reference, t.description, accountName(t), t.category, txnChannel(t), t.status, t.amount, t.currency].map(escape).join(','),
  )
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `meridian-transactions-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function Transactions() {
  const { user } = useAuth()
  const state = useAsync(() => loadData(user), [user?.userId])

  if (state.error || state.data === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader title="Transactions" subtitle="Every payment, transfer and deposit across your accounts." />
        {state.error ? (
          <Card><ErrorState error={state.error} onRetry={state.reload} title="Couldn't load transactions" /></Card>
        ) : (
          <>
            <Skeleton className="h-[132px] rounded-2xl" />
            <Card><LoadingState rows={8} label="Loading transactions…" /></Card>
          </>
        )}
      </div>
    )
  }
  return <TransactionList data={state.data} reload={state.reload} reloading={state.loading} />
}

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All' },
]

const TYPES = [
  { value: 'all', label: 'All' },
  { value: 'credit', label: 'Money in' },
  { value: 'debit', label: 'Money out' },
  { value: 'internal', label: 'Between accounts' },
]

function TransactionList({ data, reload, reloading }) {
  const { accounts, transactions } = data
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') || '')
  const [account, setAccount] = useState(params.get('account') || 'all')
  const [type, setType] = useState('all')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [range, setRange] = useState('90')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState(null)
  const [showFilters, setShowFilters] = useState(false)

  // keep ?account= in the URL so links from Accounts / back button work
  useEffect(() => {
    const next = new URLSearchParams(params)
    if (account === 'all') next.delete('account')
    else next.set('account', account)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  useEffect(() => setLimit(PAGE), [query, account, type, category, status, range])

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const accountName = (t) => {
    const ids = account !== 'all' ? [account] : t.accountIds || []
    const names = ids.map((id) => accountById.get(id)).filter(Boolean).map((a) => `${a.name} (${a.number})`)
    return names.join(' → ') || '—'
  }
  const categories = useMemo(() => [...new Set(transactions.map((t) => t.category))].sort(), [transactions])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const since = range === 'all' ? 0 : Date.now() - Number(range) * DAY
    return transactions.filter((t) => {
      if (account !== 'all' && !(t.accountIds || []).includes(account)) return false
      if (type !== 'all' && t.type !== type) return false
      if (category !== 'all' && t.category !== category) return false
      if (status !== 'all' && txnStatusKey(t) !== status) return false
      if (new Date(t.date).getTime() < since) return false
      if (q && ![t.description, t.category, t.reference, txnChannel(t), String(Math.abs(t.amount))].some((s) => String(s || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [transactions, query, account, type, category, status, range])

  const currency = accounts[0]?.currency || filtered[0]?.currency || DEFAULT_CURRENCY
  const counted = filtered.filter((t) => !isFailedTxn(t))
  const inflow = counted.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
  const outflow = counted.filter((t) => t.type === 'debit').reduce((s, t) => s + Math.abs(t.amount), 0)
  const groups = useMemo(() => groupByDay(filtered.slice(0, limit)), [filtered, limit])
  const activeFilters = [account !== 'all', type !== 'all', category !== 'all', status !== 'all', range !== '90', query !== ''].filter(Boolean).length

  const reset = () => { setQuery(''); setAccount('all'); setType('all'); setCategory('all'); setStatus('all'); setRange('90') }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        subtitle={`${filtered.length} of ${transactions.length} transactions`}
        action={
          <>
            <button type="button" className="btn-ghost" onClick={reload} disabled={reloading} aria-label="Refresh">
              {reloading ? <Spinner /> : <RefreshCw size={16} />} <span className="hidden sm:inline">Refresh</span>
            </button>
            <button type="button" className="btn-ghost" onClick={() => downloadCsv(filtered, accountName)} disabled={filtered.length === 0}>
              <Download size={16} /> Export CSV
            </button>
          </>
        }
      />

      {/* Summary for the current filter */}
      <div className="grid grid-cols-3 gap-3 sm:gap-6">
        <SummaryTile icon={ArrowDownLeft} label="Money in" value={formatSigned(inflow, currency)} tone="text-emerald-600 dark:text-emerald-400" chip="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300" />
        <SummaryTile icon={ArrowUpRight} label="Money out" value={formatSigned(-outflow, currency)} tone="heading" chip="bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300" />
        <SummaryTile icon={Scale} label="Net" value={formatSigned(inflow - outflow, currency)} tone={inflow - outflow >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} chip="bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300" />
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={query} onChange={setQuery} placeholder="Search merchant, category, reference or amount…" className="flex-1" />
          <div className="flex items-center gap-2">
            <Segmented size="sm" options={RANGES} value={range} onChange={setRange} />
            <button type="button" className={`btn-ghost px-3 lg:hidden ${showFilters ? 'border-brand-300 text-brand-700 dark:border-brand-400/40 dark:text-brand-300' : ''}`} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
              <SlidersHorizontal size={16} /> Filters{activeFilters > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{activeFilters}</span>}
            </button>
          </div>
        </div>
        <div className={`${showFilters ? 'grid' : 'hidden'} mt-3 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid lg:grid-cols-4`}>
          <FilterSelect label="Account" value={account} onChange={setAccount} options={[{ value: 'all', label: 'All accounts' }, ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.number})` }))]} />
          <FilterSelect label="Type" value={type} onChange={setType} options={TYPES.map((t) => ({ ...t, label: t.value === 'all' ? 'All types' : t.label }))} />
          <FilterSelect label="Category" value={category} onChange={setCategory} options={[{ value: 'all', label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]} />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'Any status' },
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'PENDING', label: 'Pending' },
              { value: 'PROCESSING', label: 'Processing' },
              { value: 'UNDER_REVIEW', label: 'Under review' },
              { value: 'FAILED', label: 'Failed' },
            ]}
          />
        </div>
        {activeFilters > 0 && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs dark:border-white/[0.06]">
            <span className="muted">{activeFilters} filter{activeFilters > 1 ? 's' : ''} applied</span>
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400"><X size={13} /> Clear all</button>
          </div>
        )}
      </Card>

      {/* Grouped list */}
      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          transactions.length === 0 ? (
            <EmptyState icon={Receipt} title="No transactions yet" message="Your transfers, deposits and card payments will appear here." action={<Link to="/transfer" className="btn-primary"><Send size={16} /> Send money</Link>} />
          ) : (
            <EmptyState icon={Receipt} title="No matching transactions" message="Try a wider date range or clear some filters." action={<button type="button" className="btn-ghost" onClick={reset}><X size={15} /> Clear filters</button>} />
          )
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-slate-100 bg-slate-50/95 px-5 py-2 text-xs backdrop-blur dark:border-white/[0.05] dark:bg-ink-850/95">
                  <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{g.label}</span>
                  <span className={`tabular font-semibold ${g.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>{formatSigned(g.net, currency)}</span>
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                  {g.items.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => setSelected(t)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-white/[0.03] dark:focus-visible:bg-white/[0.03] md:grid-cols-[38px_minmax(0,2fr)_minmax(0,1.4fr)_72px_140px]">
                        <TxnIcon txn={t} size={38} />
                        <div className="min-w-0">
                          <p className="heading truncate text-sm font-medium">{t.description}</p>
                          <p className="muted mt-0.5 truncate text-xs">
                            {t.category} · {formatTime(t.date)}
                            <span className="md:hidden"> · {txnChannel(t)}</span>
                          </p>
                          {t.failureReason && <p className="mt-0.5 truncate text-xs text-rose-600 dark:text-rose-400">{t.failureReason}</p>}
                        </div>
                        <p className="muted hidden truncate text-xs md:block">{accountName(t)}</p>
                        <div className="hidden md:block"><ChannelBadge txn={t} /></div>
                        <div className="flex flex-col items-end gap-1">
                          <TxnAmount txn={t} className="text-sm" />
                          <TxnStatusPill txn={t} />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <div className="flex flex-col items-center gap-2 border-t border-slate-100 px-5 py-4 dark:border-white/[0.06]">
              <p className="muted tabular text-xs">Showing {Math.min(limit, filtered.length)} of {filtered.length}</p>
              {limit < filtered.length && (
                <button type="button" className="btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>Load {Math.min(PAGE, filtered.length - limit)} more</button>
              )}
            </div>
          </>
        )}
      </Card>

      {selected && <TransactionDrawer txn={selected} accountById={accountById} onClose={() => setSelected(null)} />}
    </div>
  )
}

function SummaryTile({ icon: Icon, label, value, tone, chip }) {
  return (
    <div className="card flex items-center gap-3 p-4 sm:p-5">
      <div className={`hidden h-10 w-10 shrink-0 place-items-center rounded-xl sm:grid ${chip}`}><Icon size={19} /></div>
      <div className="min-w-0">
        <p className="muted text-xs font-medium">{label}</p>
        <p className={`tabular mt-0.5 truncate text-sm font-bold sm:text-lg ${tone}`}>{value}</p>
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }) {
  const id = `f-${label.toLowerCase()}`
  return (
    <div>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}
