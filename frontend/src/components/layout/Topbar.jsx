import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Bell, Search, LogOut, Menu, Moon, Sun, Monitor, ChevronDown, Network, UserRound } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useTheme } from '../../context/ThemeContext.jsx'
import { Avatar } from '../ui/Primitives.jsx'
import { timeAgo } from '../../lib/format.js'

/** Closes a popover when clicking outside of it. */
function useOutside(open, onClose) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && onClose()
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  return ref
}

function NotificationsMenu() {
  const { notifications, unreadCount, markRead, markAllRead } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  const navigate = useNavigate()
  const latest = notifications.slice(0, 5)

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn-icon relative" aria-label="Notifications" aria-expanded={open}>
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-ink-950">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute right-0 top-11 z-30 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden shadow-lift animate-scale-in dark:bg-ink-850">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
            <p className="heading text-sm font-semibold">Notifications</p>
            {unreadCount > 0 && <button onClick={markAllRead} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300">Mark all read</button>}
          </div>
          <ul className="max-h-80 overflow-y-auto scrollbar-thin">
            {latest.length === 0 && <li className="muted px-4 py-8 text-center text-sm">You're all caught up.</li>}
            {latest.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => { markRead(n.id); setOpen(false); navigate('/notifications') }}
                  className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand-500'}`} />
                  <span className="min-w-0">
                    <span className="heading block truncate text-sm font-medium">{n.title}</span>
                    <span className="muted line-clamp-2 block text-xs">{n.message}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.date)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-xs font-semibold text-brand-600 hover:bg-slate-50 dark:border-white/[0.06] dark:text-brand-300 dark:hover:bg-white/[0.03]">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  )
}

function UserMenu() {
  const { user, isAdmin, logout } = useAuth()
  const { preference, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ]

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-slate-100 dark:hover:bg-white/[0.06]" aria-expanded={open} aria-label="Account menu">
        <Avatar name={user?.name} size={32} />
        <div className="hidden text-left leading-tight lg:block">
          <p className="heading text-sm font-semibold">{user?.name}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{isAdmin ? 'Administrator' : 'Customer'}</p>
        </div>
        <ChevronDown size={15} className="hidden text-slate-400 lg:block" />
      </button>
      {open && (
        <div className="card absolute right-0 top-12 z-30 w-64 overflow-hidden p-1.5 shadow-lift animate-scale-in dark:bg-ink-850">
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <Avatar name={user?.name} size={36} />
            <div className="min-w-0">
              <p className="heading truncate text-sm font-semibold">{user?.name}</p>
              <p className="muted truncate text-xs">{user?.email}</p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-400">{user?.userId}</p>
            </div>
          </div>
          <div className="my-1 border-t border-slate-100 dark:border-white/[0.06]" />
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Theme</p>
          <div className="grid grid-cols-3 gap-1 px-1 pb-1.5">
            {themes.map((t) => (
              <button
                key={t.value}
                onClick={() => setTheme(t.value)}
                className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors ${preference === t.value ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5'}`}
              >
                <t.icon size={15} /> {t.label}
              </button>
            ))}
          </div>
          <div className="my-1 border-t border-slate-100 dark:border-white/[0.06]" />
          <Link to="/architecture" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5">
            <Network size={16} className="text-slate-400" /> How it works
          </Link>
          {isAdmin && (
            <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5">
              <UserRound size={16} className="text-slate-400" /> Customer view
            </Link>
          )}
          <button onClick={handleLogout} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function Topbar() {
  const { role, setPaletteOpen, setMobileNavOpen } = useApp()
  const { isAdmin } = useAuth()
  const { isDark, toggle } = useTheme()
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/75 px-4 backdrop-blur-xl dark:border-white/[0.06] dark:bg-ink-950/70 sm:px-6">
      <button onClick={() => setMobileNavOpen(true)} className="btn-icon md:hidden" aria-label="Open menu">
        <Menu size={20} />
      </button>

      {/* Command palette trigger */}
      <button
        onClick={() => setPaletteOpen(true)}
        aria-label="Search (Ctrl+K)"
        className="flex h-10 min-w-0 shrink items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-sm text-slate-400 transition-colors hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20 sm:w-full sm:max-w-sm"
      >
        <Search size={16} className="shrink-0" />
        <span className="hidden flex-1 truncate text-left sm:block">{role === 'admin' ? 'Search pages, customers, alerts…' : 'Search pages and actions…'}</span>
        <span className="hidden items-center gap-0.5 sm:flex"><kbd className="kbd">Ctrl</kbd><kbd className="kbd">K</kbd></span>
      </button>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {/* Shell switch: only admins have both */}
        {isAdmin && (
          <div className="hidden items-center rounded-xl bg-slate-100 p-1 text-xs font-semibold dark:bg-white/[0.05] sm:flex">
            {['customer', 'admin'].map((r) => (
              <button
                key={r}
                onClick={() => r !== role && navigate(r === 'admin' ? '/admin' : '/')}
                className={`rounded-lg px-3 py-1.5 capitalize transition-all ${role === r ? 'bg-white text-brand-700 shadow-sm dark:bg-ink-700 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                {r}
              </button>
            ))}
          </div>
        )}

        <button onClick={toggle} className="btn-icon" aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} title={isDark ? 'Light mode' : 'Dark mode'}>
          {isDark ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        <NotificationsMenu />
        <div className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-white/10 sm:block" />
        <UserMenu />
      </div>
    </header>
  )
}
