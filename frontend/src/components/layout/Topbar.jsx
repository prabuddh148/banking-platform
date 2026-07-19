import { useNavigate } from 'react-router-dom'
import { Bell, Search, ChevronDown } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import { currentUser, adminUser } from '../../data/mockData.js'

function initials(name) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('')
}

export default function Topbar() {
  const { role, toggleRole, unreadCount } = useApp()
  const navigate = useNavigate()
  const user = role === 'admin' ? adminUser : currentUser

  function handleToggle() {
    const next = role === 'customer' ? 'admin' : 'customer'
    toggleRole()
    navigate(next === 'admin' ? '/admin' : '/')
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/80 px-4 backdrop-blur sm:px-6">
      {/* Search */}
      <div className="relative hidden sm:block w-72 max-w-full">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder={role === 'admin' ? 'Search customers, txns…' : 'Search transactions…'} />
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* Role switch */}
        <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
          <button
            onClick={role !== 'customer' ? handleToggle : undefined}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              role === 'customer' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Customer
          </button>
          <button
            onClick={role !== 'admin' ? handleToggle : undefined}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              role === 'admin' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Admin
          </button>
        </div>

        {/* Notifications */}
        <button
          onClick={() => navigate('/notifications')}
          className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label="Notifications"
        >
          <Bell size={19} />
          {role === 'customer' && unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unreadCount}
            </span>
          )}
        </button>

        {/* User */}
        <div className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-slate-100">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
            {initials(user.name)}
          </div>
          <div className="hidden text-left leading-tight sm:block">
            <p className="text-sm font-semibold text-slate-800">{user.name}</p>
            <p className="text-[11px] text-slate-500">{role === 'admin' ? user.role : user.tier}</p>
          </div>
          <ChevronDown size={16} className="hidden text-slate-400 sm:block" />
        </div>
      </div>
    </header>
  )
}
