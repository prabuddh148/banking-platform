import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, FlaskConical, Landmark, LogIn, Moon, PlugZap, ShieldCheck, Sun, UserRound } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { DEMO_CREDENTIALS } from '../services/authService.js'
import { Avatar, ErrorBanner, Spinner } from '../components/ui/Primitives.jsx'
import LoginHero from '../components/showcase/LoginHero.jsx'
import { USE_MOCK } from '../lib/config.js'

// What each demo persona is good for (shown on the one-click buttons)
const PERSONAS = {
  rahul: { cta: 'Explore as customer', blurb: 'Accounts, transfers, insights', icon: UserRound },
  admin: { cta: 'Explore as admin', blurb: 'Fraud review, audit, events', icon: ShieldCheck },
}

export default function Login() {
  const { login, isAuthenticated, isAdmin, sessionExpired } = useAuth()
  const { isDark, toggle } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pending, setPending] = useState(null) // username of the demo login in flight
  const [error, setError] = useState(null)

  const params = new URLSearchParams(location.search)
  // ?next=/transactions: where to go after signing in (in-app paths only, no "//host" redirects)
  const nextParam = params.get('next')
  const safeNext = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : null
  const from = location.state?.from?.pathname || safeNext
  // Go back to the page that sent us here — unless a customer was bounced from an admin page.
  const targetFor = (admin) => (from && from !== '/login' && (!from.startsWith('/admin') || admin) ? from : admin ? '/admin' : '/')

  // One-click demo: /login?demo=rahul|priya|admin signs in with that demo user
  const demo = params.get('demo')
  useEffect(() => {
    const cred = demo && DEMO_CREDENTIALS.find((c) => c.username === demo)
    if (!cred || isAuthenticated) return
    setPending(cred.username)
    setError(null)
    login(cred.username, cred.password)
      .then((u) => navigate(targetFor(u.roles.includes('ROLE_ADMIN')), { replace: true }))
      .catch((err) => {
        setError(err)
        setPending(null)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo])

  if (isAuthenticated) return <Navigate to={targetFor(isAdmin)} replace />

  const busy = submitting || pending !== null

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const user = await login(username.trim(), password)
      navigate(targetFor(user.roles.includes('ROLE_ADMIN')), { replace: true })
    } catch (err) {
      setError(err)
      setSubmitting(false)
    }
  }

  async function demoLogin(cred) {
    setPending(cred.username)
    setError(null)
    try {
      const user = await login(cred.username, cred.password)
      navigate(targetFor(user.roles.includes('ROLE_ADMIN')), { replace: true })
    } catch (err) {
      setError(err)
      setPending(null)
    }
  }

  function fill(cred) {
    setUsername(cred.username)
    setPassword(cred.password)
    setError(null)
  }

  const primary = DEMO_CREDENTIALS.filter((c) => PERSONAS[c.username])
  const others = DEMO_CREDENTIALS.filter((c) => !PERSONAS[c.username])

  return (
    <div className="flex min-h-screen flex-col-reverse bg-slate-50 dark:bg-ink-950 lg:flex-row">
      <LoginHero />

      <main className="relative flex flex-1 flex-col px-5 py-6 sm:px-10 lg:py-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 lg:invisible">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-glow"><Landmark size={19} /></div>
            <span className="heading text-lg font-bold tracking-tight">Meridian</span>
          </div>
          <button type="button" onClick={toggle} className="btn-icon" aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'} title={isDark ? 'Light theme' : 'Dark theme'}>
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-[420px] animate-fade-in">
            <p className="muted mb-1 text-sm lg:hidden">Event-driven banking platform built with Spring Boot microservices, Kafka and React.</p>
            <h1 className="heading text-[26px] font-bold tracking-tight">Welcome to Meridian</h1>
            <p className="muted mt-1 text-sm">Pick a demo persona. No sign-up, one click.</p>

            {sessionExpired && !error && (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                Your session expired. Please sign in again.
              </div>
            )}

            <div className="mt-5 space-y-2.5">
              {primary.map((c) => {
                const p = PERSONAS[c.username]
                const isAdminPersona = c.label === 'Admin'
                const loading = pending === c.username
                return (
                  <button
                    key={c.username}
                    type="button"
                    onClick={() => demoLogin(c)}
                    disabled={busy}
                    className={`group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl p-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:cursor-wait dark:focus-visible:ring-offset-ink-950 ${
                      isAdminPersona
                        ? 'border border-slate-200 bg-white shadow-soft hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift dark:border-white/10 dark:bg-ink-900 dark:hover:border-brand-400/50'
                        : 'bg-gradient-to-r from-brand-600 to-violet-600 text-white shadow-glow hover:-translate-y-0.5 hover:brightness-110'
                    } ${busy && !loading ? 'opacity-60' : ''}`}
                  >
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${isAdminPersona ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300' : 'bg-white/15 text-white ring-1 ring-white/25'}`}>
                      {loading ? <Spinner size={20} /> : <p.icon size={20} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[15px] font-semibold ${isAdminPersona ? 'heading' : ''}`}>{loading ? 'Signing you in…' : p.cta}</span>
                      <span className={`block truncate text-xs ${isAdminPersona ? 'muted' : 'text-white/80'}`}>
                        {c.name} · {p.blurb}
                      </span>
                    </span>
                    <ArrowRight size={18} className={`shrink-0 transition-transform group-hover:translate-x-0.5 ${isAdminPersona ? 'text-slate-400 dark:text-slate-500' : 'text-white/90'}`} />
                  </button>
                )
              })}
              {others.map((c) => (
                <button
                  key={c.username}
                  type="button"
                  onClick={() => demoLogin(c)}
                  disabled={busy}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-slate-100 disabled:cursor-wait dark:hover:bg-white/5"
                >
                  {pending === c.username ? <span className="grid h-7 w-7 place-items-center"><Spinner /></span> : <Avatar name={c.name} size={28} />}
                  <span className="muted min-w-0 flex-1 truncate">
                    or continue as <span className="heading font-medium">{c.name}</span> (customer)
                  </span>
                  <ArrowRight size={15} className="shrink-0 text-slate-400" />
                </button>
              ))}
            </div>

            <div className="my-5 flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
              <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" /> or sign in with credentials <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label" htmlFor="username">Username</label>
                <input id="username" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="rahul" />
              </div>
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="muted mr-0.5">Fill in demo user:</span>
                {DEMO_CREDENTIALS.map((c) => (
                  <button
                    key={c.username}
                    type="button"
                    onClick={() => fill(c)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-brand-400/50 dark:hover:text-brand-200"
                    title={`${c.name} (${c.label}): ${c.username} / ${c.password}`}
                  >
                    {c.username}
                  </button>
                ))}
              </div>

              {error && <ErrorBanner error={error} />}

              <button type="submit" className="btn-primary w-full" disabled={busy || !username || !password}>
                {submitting ? <Spinner /> : <LogIn size={16} />} {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <div className="mt-6 flex justify-center">
              {USE_MOCK ? (
                <p className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/20">
                  <FlaskConical size={13} /> Demo mode: data is simulated in your browser
                </p>
              ) : (
                <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20">
                  <PlugZap size={13} /> Signs in through the API gateway (JWT)
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
