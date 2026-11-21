import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Wallet, ArrowLeftRight, Receipt, Bell,
  ShieldAlert, ScrollText, Activity, Users, Landmark, Network, Radio, Github, X,
} from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import { USE_MOCK, API_BASE_URL } from '../../lib/config.js'

export const REPO_URL = 'https://github.com/prabuddh148/banking-platform'

// Navigation per shell. Also used by the command palette.
export const customerNav = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/transfer', label: 'Send money', icon: ArrowLeftRight },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'unread' },
]

export const adminNav = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/accounts', label: 'Accounts', icon: Users },
  { to: '/admin/transactions', label: 'Transactions', icon: Receipt },
  { to: '/admin/fraud', label: 'Fraud review', icon: ShieldAlert },
  { to: '/admin/events', label: 'Event stream', icon: Radio, live: true },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { to: '/admin/services', label: 'Service health', icon: Activity },
]

export const platformNav = [
  { to: '/architecture', label: 'Architecture', icon: Network },
]

function NavItem({ item, unreadCount }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all ${
          isActive
            ? 'bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
            : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-400" />}
          <item.icon size={18} className={isActive ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300'} />
          <span className="flex-1">{item.label}</span>
          {item.badge === 'unread' && unreadCount > 0 && (
            <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{unreadCount}</span>
          )}
          {item.live && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 animate-pulse-ring" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

function SidebarContent({ onClose }) {
  const { role, unreadCount } = useApp()
  const nav = role === 'admin' ? adminNav : customerNav

  return (
    <div className="flex h-full flex-col bg-ink-950 text-slate-300">
      <div className="flex h-16 items-center gap-3 border-b border-white/[0.06] px-5">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-glow">
          <Landmark size={18} />
        </div>
        <div className="flex-1 leading-tight">
          <p className="font-bold tracking-tight text-white">Meridian</p>
          <p className="text-[11px] text-slate-500">{role === 'admin' ? 'Operations console' : 'Personal banking'}</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white md:hidden" aria-label="Close menu">
            <X size={18} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5 scrollbar-thin">
        <div className="space-y-1">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
            {role === 'admin' ? 'Operations' : 'Banking'}
          </p>
          {nav.map((item) => <NavItem key={item.to} item={item} unreadCount={unreadCount} />)}
        </div>
        <div className="space-y-1">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Platform</p>
          {platformNav.map((item) => <NavItem key={item.to} item={item} unreadCount={0} />)}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-100">
            <Github size={18} className="text-slate-500" /> Source code
          </a>
        </div>
      </nav>

      <div className="border-t border-white/[0.06] p-4">
        <div className="rounded-xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-3 text-xs ring-1 ring-inset ring-white/[0.06]">
          {USE_MOCK ? (
            <>
              <p className="flex items-center gap-1.5 font-semibold text-slate-200">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> Demo mode
              </p>
              <p className="mt-1 leading-relaxed text-slate-400">Data is simulated in your browser. The real backend runs on Spring Boot + Kafka.</p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 font-semibold text-slate-200">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Live API
              </p>
              <p className="mt-1 break-all leading-relaxed text-slate-400">Connected via the API gateway{API_BASE_URL ? ` at ${API_BASE_URL}` : ''}.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const { mobileNavOpen, setMobileNavOpen } = useApp()
  return (
    <>
      {/* Desktop */}
      <aside className="hidden w-64 shrink-0 md:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setMobileNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl animate-slide-in-left">
            <SidebarContent onClose={() => setMobileNavOpen(false)} />
          </aside>
        </div>
      )}
    </>
  )
}
