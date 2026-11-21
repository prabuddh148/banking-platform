// "Open account" dialog: POST /api/v1/accounts (CreateAccountRequest).
import { useEffect, useState } from 'react'
import { Plus, Check } from 'lucide-react'
import { Modal, ErrorBanner, Spinner } from '../ui/Primitives.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { openAccount } from '../../services/accountService.js'
import { accountTypeIcon, accountTypeTone, accountTypeBlurb, ACCOUNT_TYPE_OPTIONS, CURRENCY_OPTIONS } from '../../lib/accountTypes.js'
import { currencySymbol } from '../../lib/format.js'

const blank = (user) => ({
  customerName: user?.name || '',
  customerEmail: user?.email || '',
  customerPhone: '',
  accountType: 'SAVINGS',
  currency: 'INR',
  initialDeposit: '',
})

export default function OpenAccountModal({ open, user, onClose, onCreated }) {
  const { showToast } = useApp()
  const [form, setForm] = useState(() => blank(user))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) { setForm(blank(user)); setError(null) }
  }, [open, user])

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const deposit = form.initialDeposit === '' ? 0 : Number(form.initialDeposit)
  const phoneOk = !form.customerPhone || /^\+?[0-9 ]{7,18}$/.test(form.customerPhone)
  const valid = form.customerName.trim() && /\S+@\S+\.\S+/.test(form.customerEmail) && deposit >= 0 && phoneOk

  async function handleSubmit(e) {
    e.preventDefault()
    if (!valid || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const acc = await openAccount({ ...form, customerPhone: form.customerPhone.replace(/\s+/g, ''), initialDeposit: deposit })
      showToast({ title: 'Account opened', description: `${acc.name} ${acc.number} is ready to use.` })
      onCreated?.(acc)
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Open a new account"
      subtitle="It takes a few seconds. account-service publishes ACCOUNT_CREATED once it's live."
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="open-account-form" className="btn-primary" disabled={!valid || submitting}>
            {submitting ? <Spinner /> : <Plus size={16} />} {submitting ? 'Opening…' : 'Open account'}
          </button>
        </>
      }
    >
      <form id="open-account-form" onSubmit={handleSubmit} className="space-y-5">
        <fieldset>
          <legend className="label">Account type</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {ACCOUNT_TYPE_OPTIONS.map((o) => {
              const Icon = accountTypeIcon[o.label]
              const active = form.accountType === o.value
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, accountType: o.value }))}
                  aria-pressed={active}
                  className={`relative flex flex-col items-start justify-start rounded-xl border p-3 text-left transition-all ${active ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20 dark:border-brand-400 dark:bg-brand-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'}`}
                >
                  {active && <Check size={14} className="absolute right-2.5 top-2.5 text-brand-600 dark:text-brand-300" />}
                  <div className={`grid h-8 w-8 place-items-center rounded-lg ${accountTypeTone[o.label]}`}><Icon size={16} /></div>
                  <p className="heading mt-2 text-sm font-semibold">{o.label}</p>
                  <p className="muted mt-0.5 text-xs leading-snug">{accountTypeBlurb[o.value]}</p>
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="oa-name">Full name</label>
            <input id="oa-name" className="input" required value={form.customerName} onChange={set('customerName')} />
          </div>
          <div>
            <label className="label" htmlFor="oa-email">Email</label>
            <input id="oa-email" className="input" type="email" required value={form.customerEmail} onChange={set('customerEmail')} />
          </div>
          <div>
            <label className="label" htmlFor="oa-phone">Phone <span className="font-normal text-slate-400">(optional)</span></label>
            <input id="oa-phone" className="input" placeholder="+91 98765 43210" value={form.customerPhone} onChange={set('customerPhone')} />
            {!phoneOk && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">7 to 15 digits, may start with +.</p>}
          </div>
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <div>
              <label className="label" htmlFor="oa-cur">Currency</label>
              <select id="oa-cur" className="input" value={form.currency} onChange={set('currency')}>
                {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="oa-dep">Initial deposit</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{currencySymbol(form.currency)}</span>
                <input id="oa-dep" className="input pl-7" type="number" min="0" step="0.01" placeholder="0.00" value={form.initialDeposit} onChange={set('initialDeposit')} />
              </div>
            </div>
          </div>
        </div>

        {error && <ErrorBanner error={error} />}
      </form>
    </Modal>
  )
}
