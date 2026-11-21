// Helpers that turn backend DTO values into what the components display.
import { DEFAULT_CURRENCY } from '../lib/config.js'

/** 'FIXED_DEPOSIT' -> 'Fixed Deposit', 'UNDER_REVIEW' -> 'Under Review'. */
export function humanize(value) {
  if (!value) return ''
  return String(value)
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** 'ACC1234567890' -> '**** 7890'. */
export function maskAccountNumber(accountNumber) {
  if (!accountNumber) return '—'
  const s = String(accountNumber)
  return `**** ${s.slice(-4)}`
}

/** Short, readable form of a UUID for tables: 'a1b2c3d4-…' -> 'a1b2c3d4'. */
export function shortId(id) {
  if (!id) return '—'
  const s = String(id)
  return s.length > 12 ? s.slice(0, 8) : s
}

/** BigDecimal arrives as a JSON number (or occasionally a string). */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isNaN(n) ? null : n
}

export function currencyOf(dto) {
  return dto?.currency || DEFAULT_CURRENCY
}

export function hasRole(user, role) {
  return Array.isArray(user?.roles) && user.roles.includes(role)
}

export function isAdminUser(user) {
  return hasRole(user, 'ROLE_ADMIN')
}

/** Free-form "details" (string or JSON object) -> one display line. */
export function detailsToText(details) {
  if (details === null || details === undefined) return ''
  if (typeof details === 'string') return details
  try {
    return Object.entries(details)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' · ')
  } catch {
    return String(details)
  }
}
