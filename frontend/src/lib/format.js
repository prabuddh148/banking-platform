// Small formatting helpers shared across pages.

export function formatCurrency(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

// Signed currency: keeps the leading sign for +/- amounts (transaction rows).
export function formatSigned(value, currency = 'USD') {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatCurrency(Math.abs(value), currency)}`
}

export function formatDate(dateStr, opts) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatTime(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value)
}

export function relativeTime(dateStr) {
  const d = new Date(dateStr)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}
