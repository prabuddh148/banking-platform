import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft, Moon, Sun, LogOut, ArrowLeftRight, Github, Shield, UserRound, PlusCircle } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useTheme } from '../../context/ThemeContext.jsx'
import { customerNav, adminNav, platformNav, REPO_URL } from './Sidebar.jsx'

/**
 * Ctrl/Cmd+K launcher: jump to any page or run a quick action.
 * Keyboard: ↑/↓ to move, Enter to run, Esc to close.
 */
export default function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useApp()
  const { isAdmin, logout } = useAuth()
  const { isDark, toggle } = useTheme()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  const close = () => setPaletteOpen(false)

  const items = useMemo(() => {
    const go = (to) => () => navigate(to)
    const list = [
      ...customerNav.map((n) => ({ group: 'Customer', label: n.label, icon: n.icon, run: go(n.to), keywords: 'page' })),
      ...(isAdmin ? adminNav.map((n) => ({ group: 'Operations', label: n.label, icon: n.icon, run: go(n.to), keywords: 'admin page' })) : []),
      ...platformNav.map((n) => ({ group: 'Platform', label: n.label, icon: n.icon, run: go(n.to), keywords: 'diagram services kafka saga' })),
      { group: 'Actions', label: 'Send money', icon: ArrowLeftRight, run: go('/transfer'), keywords: 'transfer pay' },
      { group: 'Actions', label: 'Open a new account', icon: PlusCircle, run: go('/accounts?open=1'), keywords: 'create account' },
      ...(isAdmin ? [
        { group: 'Actions', label: 'Review open fraud alerts', icon: Shield, run: go('/admin/fraud'), keywords: 'fraud risk' },
        { group: 'Actions', label: 'Switch to customer view', icon: UserRound, run: go('/'), keywords: 'shell' },
      ] : []),
      { group: 'Actions', label: isDark ? 'Switch to light mode' : 'Switch to dark mode', icon: isDark ? Sun : Moon, run: toggle, keywords: 'theme dark light' },
      { group: 'Actions', label: 'View source on GitHub', icon: Github, run: () => window.open(REPO_URL, '_blank', 'noopener'), keywords: 'code repo' },
      { group: 'Actions', label: 'Sign out', icon: LogOut, run: () => { logout(); navigate('/login', { replace: true }) }, keywords: 'logout' },
    ]
    const q = query.trim().toLowerCase()
    return q ? list.filter((i) => `${i.label} ${i.group} ${i.keywords}`.toLowerCase().includes(q)) : list
  }, [query, isAdmin, isDark, toggle, navigate, logout])

  useEffect(() => {
    if (paletteOpen) {
      setQuery('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [paletteOpen])

  useEffect(() => setActive(0), [query])

  if (!paletteOpen) return null

  function run(item) {
    close()
    item.run()
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); run(items[active]) }
    else if (e.key === 'Escape') close()
  }

  let lastGroup = null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={close} />
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="card relative w-full max-w-xl overflow-hidden shadow-lift animate-scale-in dark:bg-ink-850">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 dark:border-white/[0.06]">
          <Search size={18} className="text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a page or action…"
            className="h-14 flex-1 bg-transparent text-[15px] text-slate-900 placeholder-slate-400 outline-none dark:text-white"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2 scrollbar-thin" role="listbox">
          {items.length === 0 && <li className="muted px-3 py-10 text-center text-sm">No results for “{query}”</li>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup
            lastGroup = item.group
            return (
              <li key={`${item.group}-${item.label}`}>
                {header && <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 first:pt-1">{item.group}</p>}
                <button
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(item)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${i === active ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}
                >
                  <item.icon size={17} className={i === active ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400'} />
                  <span className="flex-1">{item.label}</span>
                  {i === active && <CornerDownLeft size={14} className="text-slate-400" />}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-white/[0.06]">
          <span className="flex items-center gap-1"><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="kbd">↵</kbd> open</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
