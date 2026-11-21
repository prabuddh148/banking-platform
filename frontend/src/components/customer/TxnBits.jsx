// Small building blocks shared by the customer transaction views:
// category icon avatar, channel badge, amount text, day grouping helpers.
import {
  UtensilsCrossed, ShoppingCart, ShoppingBag, Car, Plane, Clapperboard, HeartPulse, Home, LineChart,
  Zap, Repeat, Banknote, Percent, ArrowLeftRight, ArrowDownLeft, ArrowUpRight, Receipt, PlusCircle,
} from 'lucide-react'
import { formatTxnAmount } from '../../lib/format.js'
import { isFailedTxn, txnChannel, txnStatusKey } from '../../services/mappers.js'
import { Badge } from '../ui/Primitives.jsx'

const tone = {
  orange: 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300',
  green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  pink: 'bg-pink-50 text-pink-600 dark:bg-pink-500/10 dark:text-pink-300',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
  cyan: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300',
}

/** Icon + chip colour per category (mock categories and the real-API ones). */
export const CATEGORY_META = {
  'Food & dining': { icon: UtensilsCrossed, tone: tone.orange },
  Groceries: { icon: ShoppingCart, tone: tone.green },
  Shopping: { icon: ShoppingBag, tone: tone.pink },
  Transport: { icon: Car, tone: tone.sky },
  Travel: { icon: Plane, tone: tone.cyan },
  Entertainment: { icon: Clapperboard, tone: tone.violet },
  Health: { icon: HeartPulse, tone: tone.rose },
  Rent: { icon: Home, tone: tone.amber },
  Investments: { icon: LineChart, tone: tone.brand },
  'Bills & utilities': { icon: Zap, tone: tone.amber },
  Subscriptions: { icon: Repeat, tone: tone.violet },
  Income: { icon: Banknote, tone: tone.green },
  Interest: { icon: Percent, tone: tone.green },
  Transfer: { icon: ArrowLeftRight, tone: tone.brand },
  'Transfer in': { icon: ArrowDownLeft, tone: tone.green },
  'Transfer out': { icon: ArrowUpRight, tone: tone.brand },
  Deposit: { icon: PlusCircle, tone: tone.green },
  Withdrawal: { icon: ArrowUpRight, tone: tone.slate },
}

export function categoryMeta(category) {
  return CATEGORY_META[category] || { icon: Receipt, tone: tone.slate }
}

/** Rounded icon for a transaction (by category). */
export function TxnIcon({ txn, category, size = 40 }) {
  const meta = categoryMeta(category ?? txn?.category)
  const Icon = meta.icon
  return (
    <div className={`grid shrink-0 place-items-center rounded-xl ${meta.tone}`} style={{ width: size, height: size }} aria-hidden>
      <Icon size={Math.round(size * 0.45)} />
    </div>
  )
}

/** UPI / Card / NEFT … as a quiet badge. */
export function ChannelBadge({ txn }) {
  return (
    <span className="inline-flex items-center rounded-md border border-slate-200 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-white/10 dark:text-slate-400">
      {txnChannel(txn)}
    </span>
  )
}

/** Signed amount coloured by direction (green in, ink out, struck-through when failed). */
export function TxnAmount({ txn, className = '' }) {
  const failed = isFailedTxn(txn)
  const color = txn.type === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'
  return (
    <span className={`tabular whitespace-nowrap font-semibold ${color} ${failed ? 'line-through opacity-60' : ''} ${className}`}>
      {formatTxnAmount(txn)}
    </span>
  )
}

/** Only non-settled states get a badge in lists (settled rows stay calm). */
export function TxnStatusPill({ txn }) {
  const key = txnStatusKey(txn)
  if (key === 'COMPLETED') return null
  const map = {
    PENDING: { tone: 'amber', label: 'Pending' },
    PROCESSING: { tone: 'blue', label: 'Processing' },
    UNDER_REVIEW: { tone: 'amber', label: 'Under review' },
    FAILED: { tone: 'red', label: 'Failed' },
  }
  const m = map[key] || { tone: 'slate', label: txn.status }
  return <Badge tone={m.tone} dot>{m.label}</Badge>
}

/** 'Today' / 'Yesterday' / 'Mon, 17 Nov'. */
export function dayLabel(date) {
  const d = new Date(date)
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(new Date()) - start(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
}

/** Groups a newest-first list into [{ key, label, items, net }]. */
export function groupByDay(list) {
  const groups = []
  const byKey = new Map()
  list.forEach((t) => {
    const d = new Date(t.date)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (!byKey.has(key)) {
      const g = { key, label: dayLabel(t.date), items: [], net: 0 }
      byKey.set(key, g)
      groups.push(g)
    }
    const g = byKey.get(key)
    g.items.push(t)
    if (!isFailedTxn(t) && t.type !== 'internal') g.net += t.amount
  })
  return groups
}
