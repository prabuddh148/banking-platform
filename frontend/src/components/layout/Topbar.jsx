import { useNavigate } from 'react-router-dom'
import { Bell, Search, LogOut } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'

function initials(name = '') {
  return name.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?'
}

export default function Topbar() {
  const { role, unreadCount } = useApp()
  const { user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()

  function switchTo(next) {
    if (next !== role) navigate(next === 'admin' ? '/admin' : '/')
  }

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/80 px-4 backdrop-blur sm:px-6">
      {/* Search */}
      <div className="relative hidden sm:block w-72 max-w-full">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder={role === 'admin' ? 'Search customers, txns…' : 'Search transactions…'} />
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* Role switch — only admins have both shells */}
        {isAdmin && (
          <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
            {['customer', 'admin'].map((r) => (
              <button
                key={r}
                onClick={() => switchTo(r)}
                className={`rounded-md px-3 py-1.5 capitalize transition-colors ${
                  role === r ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}

        {/* Notifications */}
        <button
          onClick={() => navigate('/notifications')}
          className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label="Notifications"
        >
          <Bell size={19} />
          {role === 'customer' && unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* User */}
        <div className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
            {initials(user?.name)}
          </div>
          <div className="hidden text-left leading-tight sm:block">
            <p className="text-sm font-semibold text-slate-800">{user?.name}</p>
            <p className="text-[11px] text-slate-500">{isAdmin ? 'Administrator' : 'Customer'} · {user?.userId}</p>
          </div>
        </div>

        <button onClick={handleLogout} className="btn-ghost px-3" title="Sign out">
          <LogOut size={16} /> <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  )
}
