import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Landmark, LogIn, KeyRound } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { DEMO_CREDENTIALS } from '../services/authService.js'
import { ErrorBanner, Spinner } from '../components/ui/Primitives.jsx'
import { USE_MOCK } from '../lib/config.js'

export default function Login() {
  const { login, isAuthenticated, isAdmin, sessionExpired } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const from = location.state?.from?.pathname
  // Go back to the page that sent us here — unless a customer was bounced from an admin page.
  const targetFor = (admin) => (from && from !== '/login' && (!from.startsWith('/admin') || admin) ? from : admin ? '/admin' : '/')

  if (isAuthenticated) return <Navigate to={targetFor(isAdmin)} replace />

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

  function fill(cred) {
    setUsername(cred.username)
    setPassword(cred.password)
    setError(null)
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
            <Landmark size={22} />
          </div>
          <div className="leading-tight">
            <p className="text-xl font-bold text-slate-900">Meridian</p>
            <p className="text-xs text-slate-500">Personal Banking &amp; Operations</p>
          </div>
        </div>

        <div className="card p-6">
          <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">
            {USE_MOCK ? 'Mock mode — no backend needed.' : 'Authenticates against the API gateway.'}
          </p>

          {sessionExpired && !error && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Your session expired. Please sign in again.</div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="username">Username</label>
              <input id="username" className="input" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {error && <ErrorBanner error={error} />}

            <button type="submit" className="btn-primary w-full" disabled={submitting || !username || !password}>
              {submitting ? <Spinner /> : <LogIn size={16} />} {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <div className="card mt-4 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <KeyRound size={16} className="text-brand-600" /> Demo credentials
          </div>
          <p className="mt-1 text-xs text-slate-500">Click a row to fill the form.</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {DEMO_CREDENTIALS.map((c) => (
              <li key={c.username}>
                <button type="button" onClick={() => fill(c)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{c.name}</p>
                    <p className="font-mono text-xs text-slate-500">{c.username} / {c.password}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.label === 'Admin' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>
                    {c.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
