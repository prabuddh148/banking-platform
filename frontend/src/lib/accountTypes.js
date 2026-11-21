import { Wallet, PiggyBank, CreditCard, Landmark } from 'lucide-react'

// Icon per (humanized) account type. Checking/Credit only occur in the mock data.
export const accountTypeIcon = {
  Savings: PiggyBank,
  Current: Wallet,
  'Fixed Deposit': Landmark,
  Checking: Wallet,
  Credit: CreditCard,
}

// Options for "open account" — values are the backend AccountType enum.
export const ACCOUNT_TYPE_OPTIONS = [
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'CURRENT', label: 'Current' },
  { value: 'FIXED_DEPOSIT', label: 'Fixed Deposit' },
]

// Currencies accepted by @ValidCurrency in common-library.
export const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP']
