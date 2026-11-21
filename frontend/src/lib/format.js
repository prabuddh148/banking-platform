// Small formatting helpers shared across pages.
import { DEFAULT_CURRENCY } from './config.js'

function localeFor(currency) {
  return currency === 'INR' ? 'en-IN' : 'en-US'
}

export function formatCurrency(value, currency = DEFAULT_CURRENCY) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  const code = currency || DEFAULT_CURRENCY
  try {
    return new Intl.NumberFormat(localeFor(code), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value))
  } catch {
    // Unknown currency code: fall back to "1,234.00 XYZ"
    return `${Number(value).toFixed(2)} ${code}`
  }
}

// Signed currency: keeps the leading sign for +/- amounts (transaction rows).
export function formatSigned(value, currency = DEFAULT_CURRENCY) {
  const n = Number(value) || 0
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${formatCurrency(Math.abs(n), currency)}`
}

// Transaction amount as shown in lists: moves between your own accounts are unsigned.
export function formatTxnAmount(t) {
  if (t.type === 'internal') return formatCurrency(Math.abs(t.amount), t.currency)
  return formatSigned(t.amount, t.currency)
}

// Symbol for a currency code (e.g. INR -> ₹), used as an input prefix.
export function currencySymbol(currency = DEFAULT_CURRENCY) {
  try {
    const part = new Intl.NumberFormat(localeFor(currency), { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency')
    return part?.value || currency
  } catch {
    return currency
  }
}

function toDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDate(dateStr, opts) {
  const d = toDate(dateStr)
  if (!d) return '—'
  return d.toLocaleDateString('en-IN', opts || { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatTime(dateStr) {
  const d = toDate(dateStr)
  if (!d) return '—'
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export function formatDateTime(dateStr) {
  const d = toDate(dateStr)
  if (!d) return '—'
  return `${formatDate(dateStr, { month: 'short', day: 'numeric' })}, ${formatTime(dateStr)}`
}

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return new Intl.NumberFormat('en-IN').format(value)
}

export function relativeTime(dateStr) {
  const d = toDate(dateStr)
  if (!d) return '—'
  const diffMs = Date.now() - d.getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

// Alias used by newer components
export const timeAgo = relativeTime

/**
 * Short money for KPI tiles and chart axes. INR uses lakh/crore (₹4.2L, ₹1.3Cr),
 * other currencies K/M/B ($4.2K, $1.3M).
 */
export function formatCompactCurrency(value, currency = DEFAULT_CURRENCY) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const sym = currencySymbol(currency)
  const abs = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  const trim = (x) => (x >= 100 ? x.toFixed(0) : x.toFixed(1)).replace(/\.0$/, '')
  if (currency === 'INR') {
    if (abs >= 1e7) return `${sign}${sym}${trim(abs / 1e7)}Cr`
    if (abs >= 1e5) return `${sign}${sym}${trim(abs / 1e5)}L`
    if (abs >= 1e3) return `${sign}${sym}${trim(abs / 1e3)}K`
    return `${sign}${sym}${Math.round(abs)}`
  }
  if (abs >= 1e9) return `${sign}${sym}${trim(abs / 1e9)}B`
  if (abs >= 1e6) return `${sign}${sym}${trim(abs / 1e6)}M`
  if (abs >= 1e3) return `${sign}${sym}${trim(abs / 1e3)}K`
  return `${sign}${sym}${Math.round(abs)}`
}

/** "Good morning" / "Good afternoon" / "Good evening" for dashboard greetings. */
export function greeting(date = new Date()) {
  const h = date.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
