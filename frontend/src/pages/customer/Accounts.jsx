import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Wallet, Send, FileText, Plus, PlusCircle, ChevronRight, CalendarClock, Percent, Snowflake, Globe,
  ShoppingCart, Nfc, Info, Landmark, Lock,
} from 'lucide-react'
import {
  PageHeader, Card, CardHeader, StatusBadge, EmptyState, ErrorState, Skeleton, CopyButton, Drawer, KeyValue, Badge,
} from '../../components/ui/Primitives.jsx'
import { Legend, SERIES, Sparkline } from '../../components/ui/Charts.jsx'
import { isFailedTxn, isSettledTxn } from '../../services/mappers.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { listMyAccounts } from '../../services/accountService.js'
import { listMyTransactions } from '../../services/transactionService.js'
import { formatCurrency, formatCompactCurrency, formatDate, formatTime } from '../../lib/format.js'
import { accountTypeIcon, accountTypeTone, canTransact } from '../../lib/accountTypes.js'
import OpenAccountModal from '../../components/customer/OpenAccountModal.jsx'
import AddMoneyModal from '../../components/customer/AddMoneyModal.jsx'
import VirtualCard from '../../components/customer/VirtualCard.jsx'
import TransactionDrawer from '../../components/customer/TransactionDrawer.jsx'
import { TxnIcon, TxnAmount, dayLabel } from '../../components/customer/TxnBits.jsx'

/** Accounts first; transactions are a nice-to-have for the detail drawer (never block the page). */
async function loadData(user) {
  const accounts = await listMyAccounts(user)
  let transactions = []
  try { transactions = await listMyTransactions(accounts) } catch { /* drawer shows no activity */ }
  return { accounts, transactions }
}

export default function Accounts() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const state = useAsync(() => loadData(user), [user?.userId])
  const showOpen = params.get('open') === '1'
  const [addMoney, setAddMoney] = useState(false)
  const setShowOpen = (open) => setParams(open ? { open: '1' } : {}, { replace: true })
  const accounts = state.data?.accounts

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        subtitle="Balances, details and controls for every Meridian account you hold."
        action={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAddMoney(true)} disabled={!accounts?.some(canTransact)}><PlusCircle size={16} /> Add money</button>
            <button type="button" className="btn-primary" onClick={() => setShowOpen(true)}><Plus size={16} /> Open account</button>
          </>
        }
      />

      {state.error ? (
        <Card><ErrorState error={state.error} onRetry={state.reload} title="Couldn't load your accounts" /></Card>
      ) : state.data === undefined ? (
        <AccountsSkeleton />
      ) : state.data.accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="No accounts yet"
            message="Open a savings, current or fixed-deposit account to get started."
            action={<button type="button" className="btn-primary" onClick={() => setShowOpen(true)}><Plus size={16} /> Open account</button>}
          />
        </Card>
      ) : (
        <AccountsView data={state.data} user={user} />
      )}

      <OpenAccountModal
        open={showOpen}
        user={user}
        onClose={() => setShowOpen(false)}
        onCreated={(acc) => state.setData((prev) => ({ ...(prev || { transactions: [] }), accounts: [...(prev?.accounts || []), acc] }))}
      />
      <AddMoneyModal open={addMoney} accounts={accounts || []} onClose={() => setAddMoney(false)} onDone={() => setTimeout(state.reload, 800)} />
    </div>
  )
}

function AccountsSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading accounts">
      <Skeleton className="h-[168px] rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[300px] rounded-2xl" />)}
      </div>
    </div>
  )
}

function AccountsView({ data, user }) {
  const { accounts, transactions } = data
  const [detail, setDetail] = useState(null)
  const currency = accounts[0]?.currency || 'INR'
  const same = accounts.filter((a) => a.currency === currency && a.status !== 'Closed')
  const total = same.reduce((s, a) => s + a.balance, 0)
  const liquid = same.filter((a) => a.type !== 'Fixed Deposit').reduce((s, a) => s + a.available, 0)
  const locked = same.filter((a) => a.type === 'Fixed Deposit').reduce((s, a) => s + a.balance, 0)
  const withRate = same.filter((a) => a.interestRate)
  const blendedRate = withRate.length && total > 0 ? withRate.reduce((s, a) => s + a.interestRate * a.balance, 0) / total : null
  const open = detail && accounts.find((a) => a.id === detail)

  return (
    <>
      {/* Net worth */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="muted text-sm font-medium">Total net worth</p>
            <p className="heading tabular mt-1 text-3xl font-bold tracking-tight sm:text-[34px]">{formatCurrency(total, currency)}</p>
            <p className="muted mt-1 text-xs">Across {same.length} {currency} account{same.length === 1 ? '' : 's'}</p>
          </div>
          <dl className="grid grid-cols-3 gap-6 text-sm">
            <div>
              <dt className="muted text-xs">Available to spend</dt>
              <dd className="heading tabular mt-0.5 font-semibold">{formatCompactCurrency(liquid, currency)}</dd>
            </div>
            <div>
              <dt className="muted text-xs">Locked in deposits</dt>
              <dd className="heading tabular mt-0.5 font-semibold">{formatCompactCurrency(locked, currency)}</dd>
            </div>
            <div>
              <dt className="muted text-xs">Blended rate</dt>
              <dd className="heading tabular mt-0.5 font-semibold">{blendedRate === null ? '—' : `${blendedRate.toFixed(2)}% p.a.`}</dd>
            </div>
          </dl>
        </div>
        {total > 0 && (
          <>
            <div className="mt-5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Share of net worth by account">
              {same.map((a, i) => (
                <div key={a.id} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(Math.max(a.balance, 0) / total) * 100}%`, background: SERIES[i % SERIES.length] }} title={`${a.name}: ${formatCurrency(a.balance, a.currency)}`} />
              ))}
            </div>
            <Legend className="mt-3" items={same.map((a, i) => ({ name: `${a.name} · ${Math.round((Math.max(a.balance, 0) / total) * 100)}%`, color: SERIES[i % SERIES.length] }))} />
          </>
        )}
      </Card>

      {/* Account cards */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((acc, i) => <AccountCard key={acc.id} acc={acc} color={SERIES[i % SERIES.length]} history={acc.type === 'Fixed Deposit' ? null : accountHistory(acc, transactions)} onOpen={() => setDetail(acc.id)} />)}
      </div>

      <MonthByAccount accounts={accounts} transactions={transactions} onOpen={setDetail} />

      {open && (
        <AccountDrawer
          acc={open}
          user={user}
          transactions={transactions.filter((t) => touches(t, open.id))}
          accounts={accounts}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  )
}

/** Signed effect of a transaction on one account (handles own-account transfers). */
function accountDelta(t, id) {
  const amt = Math.abs(t.amount)
  if (t.sourceAccountId === id && t.destinationAccountId !== id) return -amt
  if (t.destinationAccountId === id && t.sourceAccountId !== id) return amt
  return (t.accountIds || []).includes(id) ? t.amount : 0
}
const touches = (t, id) => (t.accountIds || []).includes(id) || t.sourceAccountId === id || t.destinationAccountId === id

/** Daily balance of one account over the last `days` days (walks back from today's balance). */
function accountHistory(acc, transactions, days = 30) {
  const settled = transactions.filter((t) => isSettledTxn(t) && touches(t, acc.id))
  return Array.from({ length: days + 1 }, (_, i) => {
    const at = Date.now() - (days - i) * 86400000
    return acc.balance - settled.filter((t) => new Date(t.date).getTime() > at).reduce((s, t) => s + accountDelta(t, acc.id), 0)
  })
}

/** Progress from opening to maturity, for fixed deposits. */
function maturity(acc) {
  if (!acc.maturityDate) return null
  const start = new Date(acc.opened || Date.now()).getTime()
  const end = new Date(acc.maturityDate).getTime()
  if (!(end > start)) return null
  const progress = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)))
  const monthsLeft = Math.max(0, Math.round((end - Date.now()) / (30.44 * 86400000)))
  return { progress, monthsLeft, end }
}

function AccountCard({ acc, onOpen, history, color }) {
  const Icon = accountTypeIcon[acc.type] || Wallet
  const fmt = (v) => formatCurrency(v, acc.currency)
  const m = maturity(acc)
  const isFd = acc.type === 'Fixed Deposit'

  return (
    <Card className="card-hover flex flex-col overflow-hidden">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col p-5 text-left" aria-label={`Open details for ${acc.name}`}>
        <div className="flex w-full items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${accountTypeTone[acc.type] || accountTypeTone.Current}`}><Icon size={21} /></div>
            <div className="min-w-0">
              <p className="heading truncate font-semibold">{acc.name}</p>
              <p className="muted text-xs">{acc.type} · {acc.currency}</p>
            </div>
          </div>
          <StatusBadge status={acc.status} />
        </div>

        <p className="muted mt-5 text-xs font-medium">{isFd ? 'Deposit value' : 'Balance'}</p>
        <p className={`tabular mt-0.5 text-[26px] font-bold tracking-tight ${acc.balance < 0 ? 'text-rose-600 dark:text-rose-400' : 'heading'}`}>{fmt(acc.balance)}</p>
        <p className="muted tabular mt-0.5 text-xs">
          {isFd ? 'Locked until maturity' : <>Available <span className="font-medium text-slate-700 dark:text-slate-200">{fmt(acc.available)}</span>{acc.available !== acc.balance && <> · {fmt(acc.balance - acc.available)} on hold</>}</>}
        </p>

        {m && (
          <div className="mt-4 w-full">
            <div className="flex items-center justify-between text-xs">
              <span className="muted inline-flex items-center gap-1"><CalendarClock size={13} /> Matures {formatDate(m.end)}</span>
              <span className="tabular font-medium text-slate-700 dark:text-slate-200">{Math.round(m.progress * 100)}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]" role="progressbar" aria-valuenow={Math.round(m.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Time to maturity">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500" style={{ width: `${m.progress * 100}%` }} />
            </div>
            <p className="muted mt-1 text-[11px]">{m.monthsLeft} month{m.monthsLeft === 1 ? '' : 's'} to go</p>
          </div>
        )}

        {history && (
          <div className="mt-4 w-full">
            <Sparkline data={history} height={44} color={color} />
            <p className="muted mt-1 text-[11px]">Balance, last 30 days</p>
          </div>
        )}

        <div className="mt-auto flex w-full flex-wrap items-center gap-2 pt-4">
          {acc.interestRate ? <Badge tone="green"><Percent size={11} /> {acc.interestRate}% p.a.</Badge> : null}
          {acc.ifsc && <Badge tone="slate">IFSC {acc.ifsc}</Badge>}
        </div>
      </button>

      <div className="flex items-center gap-1 border-t border-slate-100 px-5 py-2.5 dark:border-white/[0.06]">
        <span className="tabular font-mono text-xs text-slate-500 dark:text-slate-400">{acc.accountNumber ? `•••• ${String(acc.accountNumber).slice(-4)}` : acc.number}</span>
        {acc.accountNumber && <CopyButton value={acc.accountNumber} label="Copy account number" />}
        <div className="ml-auto flex items-center gap-1">
          {canTransact(acc) && <Link to={`/transfer?from=${acc.id}`} className="btn-icon h-8 w-8" aria-label={`Send money from ${acc.name}`} title="Send money"><Send size={15} /></Link>}
          <Link to={`/transactions?account=${acc.id}`} className="btn-icon h-8 w-8" aria-label={`Activity for ${acc.name}`} title="Activity"><FileText size={15} /></Link>
          <button type="button" onClick={onOpen} className="btn-icon h-8 w-8" aria-label={`Details for ${acc.name}`} title="Details"><ChevronRight size={16} /></button>
        </div>
      </div>
    </Card>
  )
}

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-slate-200 dark:bg-white/10'}`}
    >
      <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

function AccountDrawer({ acc, user, transactions, accounts, onClose }) {
  const { showToast } = useApp()
  const [controls, setControls] = useState({ frozen: false, online: true, international: false, contactless: true })
  const [selected, setSelected] = useState(null)
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const isFd = acc.type === 'Fixed Deposit'
  const m = maturity(acc)
  const fmt = (v) => formatCurrency(v, acc.currency)

  const setControl = (key, label) => (value) => {
    setControls((c) => ({ ...c, [key]: value }))
    showToast({ title: `${label} ${value ? 'on' : 'off'}`, description: 'Demo control: card settings are not sent to the backend.', tone: 'info' })
  }

  const controlRows = [
    { key: 'frozen', label: 'Freeze card', hint: 'Temporarily block all card payments', icon: Snowflake },
    { key: 'online', label: 'Online payments', hint: 'E-commerce and in-app purchases', icon: ShoppingCart },
    { key: 'international', label: 'International use', hint: 'Payments outside India', icon: Globe },
    { key: 'contactless', label: 'Contactless (tap to pay)', hint: 'Up to ₹5,000 without PIN', icon: Nfc },
  ]

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width="max-w-lg"
        title={acc.name}
        subtitle={`${acc.type} account · ${acc.number}`}
        footer={
          <>
            <Link to={`/transactions?account=${acc.id}`} className="btn-ghost"><FileText size={15} /> Statement</Link>
            {canTransact(acc) && <Link to={`/transfer?from=${acc.id}`} className="btn-primary"><Send size={15} /> Send money</Link>}
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-white/[0.04]">
            <p className="muted text-xs font-medium">{isFd ? 'Deposit value' : 'Balance'}</p>
            <p className="heading tabular mt-1 text-xl font-bold">{fmt(acc.balance)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-white/[0.04]">
            <p className="muted text-xs font-medium">Available</p>
            <p className="heading tabular mt-1 text-xl font-bold">{fmt(acc.available)}</p>
          </div>
        </div>

        {acc.status === 'Frozen' && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
            <Lock size={16} className="mt-0.5 shrink-0" /> This account is frozen by the bank. Incoming and outgoing transfers are blocked until it is unfrozen.
          </p>
        )}

        <h3 className="heading mt-6 text-[15px] font-semibold">Account details</h3>
        <KeyValue
          items={[
            { label: 'Account number', value: acc.accountNumber || acc.number, mono: true, copy: acc.accountNumber || undefined },
            acc.ifsc && { label: 'IFSC', value: acc.ifsc, mono: true, copy: acc.ifsc },
            acc.branch && { label: 'Branch', value: acc.branch },
            { label: 'Account holder', value: acc.customer && acc.customer !== '—' ? acc.customer : user?.name },
            { label: 'Type', value: acc.type },
            { label: 'Currency', value: acc.currency },
            acc.interestRate && { label: 'Interest rate', value: `${acc.interestRate}% p.a.` },
            m && { label: 'Maturity', value: `${formatDate(m.end)} (${Math.round(m.progress * 100)}% elapsed)` },
            acc.opened && { label: 'Opened', value: formatDate(acc.opened) },
            { label: 'Status', value: <StatusBadge status={acc.status} /> },
            { label: 'Account ID', value: acc.id, mono: true, copy: acc.id },
          ]}
        />

        {!isFd && (
          <>
            <div className="mt-6 flex items-center justify-between">
              <h3 className="heading text-[15px] font-semibold">Card controls</h3>
              <span className="muted inline-flex items-center gap-1 text-[11px]"><Info size={12} /> UI demo, no API yet</span>
            </div>
            <div className="mx-auto mt-3 max-w-[300px]">
              <VirtualCard size="sm" account={acc} holder={user?.name} frozen={controls.frozen || acc.status === 'Frozen'} />
            </div>
            <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-white/[0.06] dark:border-white/[0.06]">
              {controlRows.map((r) => (
                <li key={r.key} className="flex items-center gap-3 px-3.5 py-3">
                  <r.icon size={17} className="shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="heading text-sm font-medium">{r.label}</p>
                    <p className="muted text-xs">{r.hint}</p>
                  </div>
                  <Switch checked={controls[r.key]} onChange={setControl(r.key, r.label)} label={r.label} />
                </li>
              ))}
            </ul>
          </>
        )}

        {isFd && (
          <p className="mt-6 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            <Landmark size={15} className="mt-0.5 shrink-0" /> Fixed deposits can't be used for transfers. Premature withdrawal is handled at the branch.
          </p>
        )}

        <div className="mt-6 flex items-center justify-between">
          <h3 className="heading text-[15px] font-semibold">Recent activity</h3>
          <Link to={`/transactions?account=${acc.id}`} className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">View all</Link>
        </div>
        {transactions.length === 0 ? (
          <p className="muted mt-3 rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm dark:border-white/10">No transactions on this account yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/[0.05]">
            {transactions.slice(0, 6).map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setSelected(t)} className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                  <TxnIcon txn={t} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="heading truncate text-sm font-medium">{t.description}</p>
                    <p className="muted text-xs">{dayLabel(t.date)}, {formatTime(t.date)}</p>
                  </div>
                  <TxnAmount txn={t} className="text-sm" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
      {selected && <TransactionDrawer txn={selected} accountById={accountById} onClose={() => setSelected(null)} />}
    </>
  )
}

function MonthByAccount({ accounts, transactions, onOpen }) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  const rows = accounts.map((a) => {
    const list = transactions.filter((t) => touches(t, a.id) && !isFailedTxn(t) && new Date(t.date).getTime() >= monthStart)
    const deltas = list.map((t) => accountDelta(t, a.id))
    return { a, count: list.length, inflow: deltas.filter((d) => d > 0).reduce((s, d) => s + d, 0), outflow: -deltas.filter((d) => d < 0).reduce((s, d) => s + d, 0) }
  })
  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' })
  return (
    <Card className="overflow-hidden">
      <CardHeader title={`${monthName} by account`} subtitle="Money in and out of each account this month, including moves between your own accounts" />
      <div className="mt-3 overflow-x-auto scrollbar-thin">
        <table className="table-base min-w-[560px]">
          <thead>
            <tr>
              <th>Account</th>
              <th className="text-right">Transactions</th>
              <th className="text-right">Money in</th>
              <th className="text-right">Money out</th>
              <th className="text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, count, inflow, outflow }) => {
              const Icon = accountTypeIcon[a.type] || Wallet
              const net = inflow - outflow
              return (
                <tr key={a.id} className="cursor-pointer" onClick={() => onOpen(a.id)}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${accountTypeTone[a.type] || accountTypeTone.Current}`}><Icon size={15} /></span>
                      <div className="min-w-0">
                        <p className="heading truncate font-medium">{a.name}</p>
                        <p className="muted font-mono text-[11px]">{a.number}</p>
                      </div>
                    </div>
                  </td>
                  <td className="tabular whitespace-nowrap text-right text-slate-600 dark:text-slate-300">{count}</td>
                  <td className="tabular whitespace-nowrap text-right font-medium text-emerald-600 dark:text-emerald-400">{inflow ? `+${formatCurrency(inflow, a.currency)}` : '—'}</td>
                  <td className="tabular whitespace-nowrap text-right font-medium text-slate-700 dark:text-slate-200">{outflow ? `−${formatCurrency(outflow, a.currency)}` : '—'}</td>
                  <td className={`tabular whitespace-nowrap text-right font-semibold ${net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{net === 0 ? '—' : `${net > 0 ? '+' : '−'}${formatCompactCurrency(Math.abs(net), a.currency)}`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
