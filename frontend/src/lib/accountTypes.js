import { Wallet, PiggyBank, CreditCard, Landmark } from 'lucide-react'

// Icon per (humanized) account type. Checking/Credit only occur in the mock data.
export const accountTypeIcon = {
  Savings: PiggyBank,
  Current: Wallet,
  'Fixed Deposit': Landmark,
  Checking: Wallet,
  Credit: CreditCard,
}

// Icon-chip colours per account type (light + dark), used on account cards and pickers.
export const accountTypeTone = {
  Savings: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  Current: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300',
  'Fixed Deposit': 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  Checking: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300',
  Credit: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
}

// One-line explanation per type, shown in the "Open account" flow.
export const accountTypeBlurb = {
  SAVINGS: 'Earn interest on everyday savings. Free UPI and IMPS.',
  CURRENT: 'For salary and day-to-day spending, with a virtual debit card.',
  FIXED_DEPOSIT: 'Lock funds for a fixed term at a higher rate.',
}

// Options for "open account": values are the backend AccountType enum.
export const ACCOUNT_TYPE_OPTIONS = [
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'CURRENT', label: 'Current' },
  { value: 'FIXED_DEPOSIT', label: 'Fixed Deposit' },
]

// Currencies accepted by @ValidCurrency in common-library.
export const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP']

/** Accounts that can send money / receive deposits (an FD has no available balance to move). */
export const canTransact = (acc) => acc?.status === 'Active' && acc?.type !== 'Fixed Deposit'
