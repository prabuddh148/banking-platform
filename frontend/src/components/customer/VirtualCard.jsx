// Stylised virtual debit card for an account (UI only: the backend has no card API).
import { Wifi } from 'lucide-react'

/** Expiry = opened date + 5 years (or 5 years from now). */
function expiryOf(opened) {
  const d = opened ? new Date(opened) : new Date()
  const base = Number.isNaN(d.getTime()) ? new Date() : d
  let year = base.getFullYear() + 5
  while (year < new Date().getFullYear() + 1) year += 5 // keep it valid for old accounts
  return `${String(base.getMonth() + 1).padStart(2, '0')}/${String(year).slice(-2)}`
}

export default function VirtualCard({ account, holder, frozen = false, size = 'md', className = '' }) {
  const last4 = String(account?.accountNumber || account?.number || '0000').slice(-4)
  return (
    <div
      className={`relative isolate aspect-[1.586] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-brand-900 to-violet-800 p-5 text-white shadow-lift ring-1 ring-white/10 ${frozen ? 'grayscale-[0.7]' : ''} ${className}`}
      role="img"
      aria-label={`Virtual debit card ending ${last4}${frozen ? ', frozen' : ''}`}
    >
      {/* decorative light */}
      <div className="absolute -right-16 -top-20 -z-10 h-56 w-56 rounded-full bg-brand-500/40 blur-3xl" aria-hidden />
      <div className="absolute -bottom-24 -left-10 -z-10 h-56 w-56 rounded-full bg-fuchsia-500/25 blur-3xl" aria-hidden />
      <svg className="absolute inset-0 -z-10 h-full w-full opacity-[0.07]" aria-hidden>
        <defs>
          <pattern id="vc-lines" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="22" stroke="white" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#vc-lines)" />
      </svg>

      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-white/15 text-sm font-black backdrop-blur">M</div>
            <span className="text-sm font-semibold tracking-[0.18em]">MERIDIAN</span>
          </div>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
            {frozen ? 'Frozen' : 'Virtual · Debit'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* EMV chip */}
          <div className="relative h-8 w-11 rounded-md bg-gradient-to-br from-amber-200 via-amber-300 to-amber-500 shadow-inner" aria-hidden>
            <div className="absolute inset-x-0 top-1/2 h-px bg-amber-700/40" />
            <div className="absolute inset-y-0 left-1/3 w-px bg-amber-700/40" />
            <div className="absolute inset-y-0 right-1/3 w-px bg-amber-700/40" />
          </div>
          <Wifi size={20} className="rotate-90 text-white/70" aria-hidden />
        </div>

        <div>
          <p className={`tabular whitespace-nowrap font-mono text-white/95 ${size === 'sm' ? 'text-[15px] tracking-[0.1em]' : 'text-[clamp(14px,4.2vw,19px)] tracking-[0.16em]'}`}>•••• •••• •••• {last4}</p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-wider text-white/50">Card holder</p>
              <p className="truncate text-sm font-semibold uppercase tracking-wide">{holder || 'Card holder'}</p>
            </div>
            <div className="shrink-0">
              <p className="text-[9px] uppercase tracking-wider text-white/50">Expires</p>
              <p className="tabular font-mono text-sm font-semibold">{expiryOf(account?.opened)}</p>
            </div>
            {/* network mark: two overlapping circles, deliberately unbranded */}
            <div className="flex shrink-0 -space-x-3" aria-hidden>
              <span className="h-8 w-8 rounded-full bg-white/80 mix-blend-screen" />
              <span className="h-8 w-8 rounded-full bg-brand-300/80 mix-blend-screen" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
