import { useState } from 'react'
import { ArrowLeftRight, ArrowRight } from 'lucide-react'
import { PageHeader, Card } from '../../components/ui/Primitives.jsx'
import { accounts } from '../../data/mockData.js'
import { formatCurrency } from '../../lib/format.js'
import { useApp } from '../../context/AppContext.jsx'

const quickAmounts = [50, 100, 250, 500]

export default function Transfer() {
  const { showToast } = useApp()
  const [from, setFrom] = useState(accounts[0].id)
  const [to, setTo] = useState(accounts[1].id)
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')

  const fromAcc = accounts.find((a) => a.id === from)
  const numericAmount = parseFloat(amount) || 0
  const sameAccount = from === to
  const overBalance = fromAcc && fromAcc.type !== 'Credit' && numericAmount > fromAcc.available
  const canSubmit = numericAmount > 0 && !sameAccount && !overBalance

  function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    showToast(`Transfer of ${formatCurrency(numericAmount)} submitted`)
    setAmount('')
    setMemo('')
  }

  return (
    <>
      <PageHeader title="Move money" subtitle="Transfer between your accounts instantly." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">From</label>
                <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.number})</option>
                  ))}
                </select>
                {fromAcc && (
                  <p className="mt-1.5 text-xs text-slate-500">Available: {formatCurrency(fromAcc.available)}</p>
                )}
              </div>
              <div>
                <label className="label">To</label>
                <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.number})</option>
                  ))}
                </select>
                {sameAccount && <p className="mt-1.5 text-xs text-rose-600">Choose two different accounts.</p>}
              </div>
            </div>

            <div>
              <label className="label">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input pl-7 text-lg font-semibold"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              {overBalance && <p className="mt-1.5 text-xs text-rose-600">Amount exceeds available balance.</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {quickAmounts.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAmount(String(q))}
                    className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700"
                  >
                    ${q}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Memo (optional)</label>
              <input className="input" placeholder="e.g. Monthly savings" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>

            <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
              <ArrowLeftRight size={16} /> Review & send
            </button>
          </form>
        </Card>

        {/* Summary */}
        <Card className="p-6 h-fit">
          <h3 className="font-semibold text-slate-900">Transfer summary</h3>
          <div className="mt-4 space-y-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">From</span>
              <span className="font-medium text-slate-800 text-right">{accounts.find((a) => a.id === from)?.name}</span>
            </div>
            <div className="grid place-items-center text-slate-300"><ArrowRight size={16} className="rotate-90" /></div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">To</span>
              <span className="font-medium text-slate-800 text-right">{accounts.find((a) => a.id === to)?.name}</span>
            </div>
            <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
              <span className="text-slate-500">Amount</span>
              <span className="text-xl font-bold text-slate-900">{formatCurrency(numericAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Fee</span>
              <span className="font-medium text-emerald-600">Free</span>
            </div>
          </div>
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            Internal transfers are instant. This is a mock — no funds actually move.
          </p>
        </Card>
      </div>
    </>
  )
}
