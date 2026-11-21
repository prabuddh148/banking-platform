import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Wallet, Send, FileText, Plus, X } from 'lucide-react'
import { PageHeader, Card, StatusBadge, AsyncView, EmptyState, ErrorBanner, Spinner } from '../../components/ui/Primitives.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { listMyAccounts, openAccount } from '../../services/accountService.js'
import { formatCurrency } from '../../lib/format.js'
import { accountTypeIcon, ACCOUNT_TYPE_OPTIONS, CURRENCY_OPTIONS } from '../../lib/accountTypes.js'

export default function Accounts() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const state = useAsync(() => listMyAccounts(user), [user?.userId])
  const showForm = params.get('open') === '1'

  const setShowForm = (open) => setParams(open ? { open: '1' } : {}, { replace: true })

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="All of your Meridian accounts in one place."
        action={
          !showForm && (
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              <Plus size={16} /> Open account
            </button>
          )
        }
      />

      {showForm && (
        <OpenAccountForm
          user={user}
          onCancel={() => setShowForm(false)}
          onCreated={(acc) => {
            state.setData((prev) => [...(prev || []), acc])
            setShowForm(false)
          }}
        />
      )}

      <AsyncView state={state} card loadingLabel="Loading accounts…" errorTitle="Couldn't load your accounts">
        {(accounts) =>
          accounts.length === 0 ? (
            <Card>
              <EmptyState
                icon={Wallet}
                title="No accounts yet"
                message="Open a savings, current or fixed-deposit account to get started."
                action={!showForm && <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Open account</button>}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {accounts.map((acc) => <AccountCard key={acc.id} acc={acc} />)}
            </div>
          )
        }
      </AsyncView>
    </>
  )
}

function AccountCard({ acc }) {
  const Icon = accountTypeIcon[acc.type] || Wallet
  const isCredit = acc.type === 'Credit'
  const utilization = isCredit && acc.limit ? Math.abs(acc.balance) / acc.limit : null
  const fmt = (v) => formatCurrency(v, acc.currency)

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <Icon size={22} />
          </div>
          <div>
            <p className="font-semibold text-slate-900">{acc.name}</p>
            <p className="text-sm text-slate-500">{acc.type} · {acc.number} · {acc.currency}</p>
          </div>
        </div>
        <StatusBadge status={acc.status} />
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-100">
        <div className="bg-white p-5">
          <p className="text-xs font-medium text-slate-500">{isCredit ? 'Current balance' : 'Balance'}</p>
          <p className={`mt-1 text-xl font-bold ${acc.balance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{fmt(acc.balance)}</p>
        </div>
        <div className="bg-white p-5">
          <p className="text-xs font-medium text-slate-500">{isCredit ? 'Available credit' : 'Available'}</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{fmt(acc.available)}</p>
        </div>
      </div>

      {utilization !== null && (
        <div className="px-5 pb-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Credit utilization</span>
            <span className="font-medium text-slate-700">{Math.round(utilization * 100)}% of {fmt(acc.limit)}</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-slate-100">
            <div className={`h-2 rounded-full ${utilization > 0.3 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${utilization * 100}%` }} />
          </div>
        </div>
      )}

      {acc.apy && (
        <div className="px-5 py-2 text-xs text-emerald-700 bg-emerald-50/50">
          Earning <span className="font-semibold">{acc.apy}% APY</span> — accrued monthly.
        </div>
      )}

      {acc.status === 'Frozen' && (
        <div className="px-5 py-2 text-xs text-rose-700 bg-rose-50/60">
          This account is frozen. Contact support to unfreeze it.
        </div>
      )}

      <div className="flex gap-2 border-t border-slate-100 p-4">
        <Link to={`/transfer?from=${acc.id}`} className={`btn-ghost flex-1 ${acc.status !== 'Active' ? 'pointer-events-none opacity-50' : ''}`}>
          <Send size={15} /> Transfer
        </Link>
        <Link to={`/transactions?account=${acc.id}`} className="btn-ghost flex-1"><FileText size={15} /> Activity</Link>
      </div>
    </Card>
  )
}

function OpenAccountForm({ user, onCancel, onCreated }) {
  const { showToast } = useApp()
  const [form, setForm] = useState({
    customerName: user?.name || '',
    customerEmail: user?.email || '',
    customerPhone: '',
    accountType: 'SAVINGS',
    currency: 'INR',
    initialDeposit: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const deposit = form.initialDeposit === '' ? 0 : Number(form.initialDeposit)
  const valid = form.customerName.trim() && /\S+@\S+\.\S+/.test(form.customerEmail) && deposit >= 0

  async function handleSubmit(e) {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError(null)
    try {
      const acc = await openAccount({ ...form, initialDeposit: deposit })
      showToast(`${acc.name} ${acc.number} opened`)
      onCreated(acc)
    } catch (err) {
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="mb-6 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Open a new account</h2>
        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={onCancel} aria-label="Close"><X size={18} /></button>
      </div>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Full name</label>
          <input className="input" required value={form.customerName} onChange={set('customerName')} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={form.customerEmail} onChange={set('customerEmail')} />
        </div>
        <div>
          <label className="label">Phone (optional)</label>
          <input className="input" placeholder="+91 98765 43210" value={form.customerPhone} onChange={set('customerPhone')} />
        </div>
        <div>
          <label className="label">Account type</label>
          <select className="input" value={form.accountType} onChange={set('accountType')}>
            {ACCOUNT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Currency</label>
          <select className="input" value={form.currency} onChange={set('currency')}>
            {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Initial deposit</label>
          <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={form.initialDeposit} onChange={set('initialDeposit')} />
        </div>

        {error && <div className="sm:col-span-2"><ErrorBanner error={error} /></div>}

        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!valid || submitting}>
            {submitting ? <Spinner /> : <Plus size={16} />} {submitting ? 'Opening…' : 'Open account'}
          </button>
        </div>
      </form>
    </Card>
  )
}
