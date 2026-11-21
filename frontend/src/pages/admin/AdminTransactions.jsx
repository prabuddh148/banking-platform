import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Receipt, Download, Flag, ChevronRight, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CheckCircle2, XCircle, Clock, GitBranch, ScrollText, Banknote } from 'lucide-react'
import { PageHeader, Card, StatusBadge, Badge, EmptyState, ErrorState, LoadingState, SearchInput, Segmented, Pagination, Drawer, KeyValue, Timeline, Avatar } from '../../components/ui/Primitives.jsx'
import { SortTh, RefreshButton, RiskScore } from '../../components/admin/AdminBits.jsx'
import { useSorted, usePaged } from '../../components/admin/hooks.js'
import { downloadCsv, stamp } from '../../components/admin/csv.js'
import { useAsync } from '../../lib/useAsync.js'
import { listPlatformTransactions, getTransactionHistory } from '../../services/adminService.js'
import { formatCurrency, formatCompactCurrency, formatDateTime, formatNumber } from '../../lib/format.js'
import { humanize, shortId } from '../../services/mappers.js'

const PAGE_SIZE = 12
const STATUSES = ['Completed', 'Processing', 'Pending', 'Under Review', 'Failed']
const TYPES = ['TRANSFER', 'DEPOSIT', 'WITHDRAWAL']

const isFlagged = (t) => t.rawStatus === 'UNDER_REVIEW' || t.failureCode === 'FRAUD_BLOCKED' || (t.riskScore ?? 0) >= 60
const kindOf = (t) => t.transactionType || (t.type === 'credit' ? 'DEPOSIT' : t.type === 'debit' ? 'WITHDRAWAL' : 'TRANSFER')
const KIND_ICON = { DEPOSIT: ArrowDownLeft, WITHDRAWAL: ArrowUpRight, TRANSFER: ArrowLeftRight }

export default function AdminTransactions() {
  const state = useAsync(() => listPlatformTransactions(), [])
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="transaction-service"
        title="Transactions"
        subtitle={state.data ? `Latest ${formatNumber(state.data.items.length)} transactions moving through the saga orchestrator.` : 'Every transaction moving through the saga orchestrator.'}
        action={<RefreshButton loading={state.loading} onClick={state.reload} />}
      />
      {state.error ? (
        <Card><ErrorState error={state.error} onRetry={state.reload} title="Couldn't load transactions" /></Card>
      ) : state.data === undefined ? (
        <Card><LoadingState rows={8} label="Loading transactions…" /></Card>
      ) : (
        <TransactionsView items={state.data.items} />
      )}
    </div>
  )
}

function TransactionsView({ items }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [kind, setKind] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [detail, setDetail] = useState(null)

  const statusCount = (s) => items.filter((t) => t.status === s).length
  const presentStatuses = STATUSES.filter((s) => statusCount(s) > 0)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((t) => {
      if (flaggedOnly && !isFlagged(t)) return false
      if (status !== 'all' && t.status !== status) return false
      if (kind && kindOf(t) !== kind) return false
      if (q && ![t.description, t.id, t.reference, t.customer, t.counterparty, t.initiatedBy].some((s) => String(s || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [items, query, status, kind, flaggedOnly])
  const { sorted, sort, toggle } = useSorted(filtered, {
    date: (t) => new Date(t.date).getTime(), customer: (t) => t.customer, amount: (t) => Math.abs(t.amount), risk: (t) => t.riskScore, status: (t) => t.status,
  }, { field: 'date', dir: 'desc' })
  const { page, setPage, pageCount, pageRows } = usePaged(sorted, PAGE_SIZE, `${query}|${status}|${kind}|${flaggedOnly}|${sort.field}|${sort.dir}`)

  const completed = items.filter((t) => t.rawStatus === 'COMPLETED')
  const volume = completed.reduce((s, t) => s + Math.abs(t.amount), 0)
  const failed = items.filter((t) => t.rawStatus === 'FAILED').length

  function exportCsv() {
    downloadCsv(`transactions-${stamp()}.csv`, [
      { header: 'reference', value: (t) => t.reference },
      { header: 'id', value: (t) => t.id },
      { header: 'createdAt', value: (t) => t.date },
      { header: 'type', value: kindOf },
      { header: 'status', value: (t) => t.rawStatus || t.status },
      { header: 'amount', value: (t) => Math.abs(t.amount).toFixed(2) },
      { header: 'currency', value: (t) => t.currency },
      { header: 'customer', value: (t) => t.customer },
      { header: 'initiatedBy', value: (t) => t.initiatedBy },
      { header: 'sourceAccountId', value: (t) => t.sourceAccountId },
      { header: 'destinationAccountId', value: (t) => t.destinationAccountId },
      { header: 'riskScore', value: (t) => t.riskScore },
      { header: 'failureCode', value: (t) => t.failureCode },
      { header: 'description', value: (t) => t.description },
    ], sorted)
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
        <Mini icon={Receipt} label="Transactions" value={formatNumber(items.length)} />
        <Mini icon={Banknote} label="Completed volume" value={formatCompactCurrency(volume, 'INR')} />
        <Mini icon={Clock} label="Under review" value={formatNumber(statusCount('Under Review'))} />
        <Mini icon={XCircle} label="Failed" value={formatNumber(failed)} hint={items.length ? `${((failed / items.length) * 100).toFixed(1)}% of sample` : undefined} />
      </div>

      <Card className="overflow-hidden">
        <div className="space-y-3 border-b border-slate-100 p-4 dark:border-white/[0.06]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <SearchInput className="flex-1" value={query} onChange={setQuery} placeholder="Search reference, customer, description…" />
            <div className="flex flex-wrap items-center gap-3">
              <label className="sr-only" htmlFor="txn-kind">Type</label>
              <select id="txn-kind" className="input w-auto py-1.5" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">All types</option>
                {TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </select>
              <label className="flex select-none items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-white/20 dark:bg-white/5" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
                Flagged only
              </label>
              <button type="button" className="btn-ghost py-1.5" onClick={exportCsv} disabled={!sorted.length}><Download size={15} /> CSV</button>
            </div>
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <Segmented size="sm" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All', count: items.length }, ...presentStatuses.map((s) => ({ value: s, label: s, count: statusCount(s) }))]} />
          </div>
        </div>

        {sorted.length === 0 ? (
          <EmptyState icon={Receipt} title={items.length === 0 ? 'No transactions yet' : 'No transactions match'} message={items.length === 0 ? 'Transactions appear here as customers move money.' : 'Try a different search or filter.'} />
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin md:block">
              <table className="table-base min-w-[880px]">
                <thead>
                  <tr>
                    <SortTh label="Time" field="date" sort={sort} onSort={toggle} />
                    <th>Reference</th>
                    <SortTh label="Customer" field="customer" sort={sort} onSort={toggle} />
                    <th>Type</th>
                    <SortTh label="Risk" field="risk" sort={sort} onSort={toggle} />
                    <SortTh label="Status" field="status" sort={sort} onSort={toggle} />
                    <SortTh label="Amount" field="amount" sort={sort} onSort={toggle} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t) => {
                    const k = kindOf(t)
                    const Icon = KIND_ICON[k] || ArrowLeftRight
                    return (
                      <tr key={t.id} className={`cursor-pointer ${isFlagged(t) ? 'bg-rose-50/40 dark:bg-rose-500/[0.04]' : ''}`} onClick={() => setDetail(t)}>
                        <td className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{formatDateTime(t.date)}</td>
                        <td className="font-mono text-xs text-slate-600 dark:text-slate-300" title={t.id}>{t.reference}</td>
                        <td>
                          <p className="heading font-medium">{t.customer}</p>
                          <p className="muted max-w-[220px] truncate text-xs">{t.counterparty ? `→ ${t.counterparty}` : t.description}</p>
                        </td>
                        <td>
                          <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                            <Icon size={14} className="text-slate-400" /> {humanize(k)}
                          </span>
                          {isFlagged(t) && <Badge tone="red" className="ml-2"><Flag size={10} /> Flagged</Badge>}
                        </td>
                        <td>{t.riskScore != null ? <span className="tabular text-slate-700 dark:text-slate-200">{t.riskScore}</span> : <span className="muted">—</span>}</td>
                        <td><StatusBadge status={t.status} /></td>
                        <td className={`tabular whitespace-nowrap text-right font-semibold ${k === 'DEPOSIT' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                          {k === 'DEPOSIT' ? '+' : k === 'WITHDRAWAL' ? '−' : ''}{formatCurrency(Math.abs(t.amount), t.currency)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-white/[0.05]">
              {pageRows.map((t) => {
                const k = kindOf(t)
                const Icon = KIND_ICON[k] || ArrowLeftRight
                return (
                  <li key={t.id}>
                    <button type="button" onClick={() => setDetail(t)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-300"><Icon size={16} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="heading truncate text-sm font-medium">{t.customer}</span>
                          <span className={`tabular shrink-0 text-sm font-semibold ${k === 'DEPOSIT' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>{k === 'DEPOSIT' ? '+' : k === 'WITHDRAWAL' ? '−' : ''}{formatCurrency(Math.abs(t.amount), t.currency)}</span>
                        </span>
                        <span className="mt-1 flex items-center justify-between gap-2">
                          <span className="muted truncate text-xs">{formatDateTime(t.date)} · {humanize(k)}</span>
                          <StatusBadge status={t.status} />
                        </span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-slate-400" />
                    </button>
                  </li>
                )
              })}
            </ul>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} total={sorted.length} pageSize={PAGE_SIZE} />
          </>
        )}
      </Card>

      <TransactionDrawer txn={detail} onClose={() => setDetail(null)} />
    </>
  )
}

const STEP_ICON = { PENDING: Clock, PROCESSING: ArrowLeftRight, UNDER_REVIEW: Flag, COMPLETED: CheckCircle2, FAILED: XCircle }
const STEP_STATE = { PENDING: 'done', PROCESSING: 'done', UNDER_REVIEW: 'warning', COMPLETED: 'done', FAILED: 'failed' }

function TransactionDrawer({ txn: t, onClose }) {
  const history = useAsync(() => (t ? getTransactionHistory(t.id) : Promise.resolve([])), [t?.id])
  const k = t ? kindOf(t) : null
  const steps = (history.data || []).map((h, i, arr) => ({
    title: humanize(h.toStatus),
    description: h.reason,
    time: formatDateTime(h.changedAt),
    icon: STEP_ICON[h.toStatus],
    state: i === arr.length - 1 && ['PENDING', 'PROCESSING'].includes(h.toStatus) ? 'current' : STEP_STATE[h.toStatus] || 'done',
  }))

  return (
    <Drawer open={Boolean(t)} onClose={onClose} title={t ? `${humanize(k)} · ${t.reference}` : 'Transaction'} subtitle={t ? formatDateTime(t.date) : ''} width="max-w-lg">
      {t && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 p-5 text-center dark:border-white/10">
            <p className="muted text-xs font-medium uppercase tracking-wide">{humanize(k)}</p>
            <p className="heading tabular mt-1 text-3xl font-bold tracking-tight">{formatCurrency(Math.abs(t.amount), t.currency)}</p>
            <div className="mt-2 flex items-center justify-center gap-2"><StatusBadge status={t.status} />{isFlagged(t) && <Badge tone="red"><Flag size={10} /> Flagged</Badge>}</div>
            {t.failureReason && <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{t.failureCode ? <span className="font-mono">{t.failureCode}</span> : null} {t.failureReason}</p>}
          </div>

          <div className="flex items-center gap-3">
            <Avatar name={t.customer} size={36} />
            <div className="min-w-0 flex-1">
              <p className="heading truncate text-sm font-semibold">{t.customer}</p>
              <p className="muted truncate text-xs">{t.counterparty ? `to ${t.counterparty}` : t.description}</p>
            </div>
            {t.riskScore != null && <RiskScore score={t.riskScore} size={38} />}
          </div>

          <KeyValue items={[
            { label: 'Reference', value: t.reference, mono: true, copy: true },
            { label: 'Transaction ID', value: t.id, mono: true, copy: true },
            t.sourceAccountId && { label: 'Source account', value: t.sourceAccountId, mono: true },
            t.destinationAccountId && { label: 'Destination account', value: t.destinationAccountId, mono: true },
            t.initiatedBy && { label: 'Initiated by', value: t.initiatedBy, mono: true },
            t.clientCountry && { label: 'Client country', value: t.clientCountry, mono: true },
            { label: 'Description', value: t.description },
            t.completedAt && { label: 'Completed', value: formatDateTime(t.completedAt) },
          ]} />

          <div>
            <h3 className="heading mb-3 text-sm font-semibold">Saga status history</h3>
            {history.error ? (
              <p className="muted text-sm">History unavailable: {history.error.message}</p>
            ) : history.loading && !history.data ? (
              <LoadingState rows={3} />
            ) : steps.length === 0 ? (
              <p className="muted text-sm">No status changes recorded.</p>
            ) : (
              <Timeline items={steps} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {t.correlationId ? (
              <Link to={`/admin/events?correlation=${t.correlationId}`} className="btn-ghost text-xs"><GitBranch size={14} /> Saga events</Link>
            ) : (
              <Link to={`/admin/events?q=${t.id}`} className="btn-ghost text-xs"><GitBranch size={14} /> Event stream</Link>
            )}
            <Link to={`/admin/audit?q=${encodeURIComponent(t.id)}`} className="btn-ghost text-xs"><ScrollText size={14} /> Audit trail</Link>
          </div>
        </div>
      )}
    </Drawer>
  )
}

function Mini({ icon: Icon, label, value, hint }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between"><p className="muted text-xs font-medium">{label}</p><Icon size={16} className="text-slate-400" /></div>
      <p className="heading tabular mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="muted mt-0.5 text-xs">{hint}</p>}
    </Card>
  )
}
