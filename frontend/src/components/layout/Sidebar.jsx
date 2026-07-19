import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Wallet, ArrowLeftRight, Receipt, Bell,
  ShieldAlert, ScrollText, Activity, Users, Landmark,
} from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'

const customerNav = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/transfer', label: 'Transfer', icon: ArrowLeftRight },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/notifications', label: 'Notifications', icon: Bell },
]

const adminNav = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/accounts', label: 'Accounts', icon: Users },
  { to: '/admin/transactions', label: 'Transactions', icon: Receipt },
  { to: '/admin/fraud', label: 'Fraud Alerts', icon: ShieldAlert },
  { to: '/admin/audit', label: 'Audit Log', icon: ScrollText },
  { to: '/admin/services', label: 'Service Health', icon: Activity },
]

export default function Sidebar() {
  const { role } = useApp()
  const nav = role === 'admin' ? adminNav : customerNav

  return (
    <aside className="hidden md:flex md:w-64 flex-col bg-slate-900 text-slate-300">
      <div className="flex items-center gap-2.5 px-6 h-16 border-b border-white/10">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
          <Landmark size={18} />
        </div>
        <div className="leading-tight">
          <p className="text-white font-bold">Meridian</p>
          <p className="text-[11px] text-slate-400 -mt-0.5">
            {role === 'admin' ? 'Operations Console' : 'Personal Banking'}
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-1">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {role === 'admin' ? 'Operations' : 'Banking'}
        </p>
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-white/10">
        <div className="rounded-lg bg-white/5 p-3 text-xs text-slate-400">
          <p className="font-semibold text-slate-200">Mock environment</p>
          <p className="mt-1 leading-relaxed">
            All data is simulated. No backend is connected.
          </p>
        </div>
      </div>
    </aside>
  )
}
