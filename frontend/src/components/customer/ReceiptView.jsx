// Print-friendly payment receipt. Rendered in a full-screen overlay (portal); when printing,
// the app root is hidden and only the paper receipt is printed (buttons are .no-print).
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { formatCurrency, formatDate, formatTime } from '../../lib/format.js'
import { txnChannel, txnStatusKey } from '../../services/mappers.js'

const PRINT_CSS = `
@media print {
  #root { display: none !important; }
  .receipt-overlay { position: static !important; background: none !important; padding: 0 !important; display: block !important; }
  .receipt-paper { box-shadow: none !important; border: 0 !important; margin: 0 auto !important; }
  @page { margin: 16mm; }
}`

export default function ReceiptView({ txn, accountLabel, counterparty, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const key = txnStatusKey(txn)
  const status = key === 'COMPLETED'
    ? { icon: CheckCircle2, label: 'Successful', cls: 'text-emerald-700 bg-emerald-50' }
    : key === 'FAILED'
      ? { icon: XCircle, label: 'Failed', cls: 'text-rose-700 bg-rose-50' }
      : { icon: Clock, label: key === 'UNDER_REVIEW' ? 'Under review' : key === 'PENDING' ? 'Pending' : 'Processing', cls: 'text-amber-800 bg-amber-50' }
  const StatusIcon = status.icon
  const credit = txn.type === 'credit'

  const rows = [
    ['Reference', txn.reference, true],
    ['Date', formatDate(txn.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })],
    ['Time', formatTime(txn.date)],
    [credit ? 'Credited to' : 'Paid from', accountLabel],
    [credit ? 'Received from' : 'Paid to', counterparty || txn.description],
    ['Payment method', txnChannel(txn)],
    ['Category', txn.category],
    ['Description', txn.description],
    txn.failureReason && ['Failure reason', txn.failureReason],
    ['Transaction ID', txn.id, true],
  ].filter(Boolean)

  return createPortal(
    <div className="receipt-overlay fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm animate-fade-in sm:p-8" role="dialog" aria-modal="true" aria-label="Payment receipt">
      <style>{PRINT_CSS}</style>
      <div className="w-full max-w-md">
        <div className="no-print mb-3 flex justify-end gap-2">
          <button type="button" className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-xl bg-white/90 text-slate-700 hover:bg-white" onClick={onClose} aria-label="Close receipt"><X size={18} /></button>
        </div>

        {/* The paper itself is always light, like a printed slip. */}
        <div className="receipt-paper overflow-hidden rounded-2xl bg-white text-slate-800 shadow-lift">
          <div className="flex items-center justify-between bg-gradient-to-br from-brand-600 to-violet-700 px-6 py-5 text-white">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 font-black">M</div>
              <div>
                <p className="text-sm font-bold tracking-wide">Meridian Bank</p>
                <p className="text-[11px] text-white/70">Payment receipt</p>
              </div>
            </div>
            <p className="text-right text-[11px] text-white/70">Issued {formatDate(new Date().toISOString())}</p>
          </div>

          <div className="border-b border-dashed border-slate-200 px-6 py-6 text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{credit ? 'Amount received' : 'Amount paid'}</p>
            <p className="tabular mt-1 text-4xl font-bold tracking-tight text-slate-900">{formatCurrency(Math.abs(txn.amount), txn.currency)}</p>
            <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${status.cls}`}>
              <StatusIcon size={14} /> {status.label}
            </span>
          </div>

          <dl className="divide-y divide-slate-100 px-6 py-2 text-sm">
            {rows.map(([label, value, mono]) => (
              <div key={label} className="flex justify-between gap-6 py-2.5">
                <dt className="shrink-0 text-slate-500">{label}</dt>
                <dd className={`text-right font-medium text-slate-900 ${mono ? 'break-all font-mono text-xs' : ''}`}>{value || '—'}</dd>
              </div>
            ))}
          </dl>

          <div className="bg-slate-50 px-6 py-4 text-[11px] leading-relaxed text-slate-500">
            Computer-generated receipt; no signature required. Processed through Meridian's transaction saga
            (fraud check, then an atomic balance update). Questions? Quote the reference above.
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
