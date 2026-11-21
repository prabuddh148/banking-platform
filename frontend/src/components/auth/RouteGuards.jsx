import { Navigate, Outlet, useLocation, Link } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'

// Only logged-in users get past this; others are sent to /login (and come back afterwards).
export function RequireAuth() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

// Admin pages need ROLE_ADMIN. The backend enforces this too — this just avoids
// showing customers screens that would only return 403s.
export function RequireAdmin() {
  const { isAdmin } = useAuth()
  if (!isAdmin) {
    return (
      <div className="grid place-items-center py-24 text-center">
        <ShieldOff size={44} className="text-slate-300" />
        <p className="mt-3 text-lg font-semibold text-slate-700">Admins only</p>
        <p className="mt-1 text-sm text-slate-500">Your account does not have the ROLE_ADMIN role.</p>
        <Link to="/" className="btn-primary mt-4">Back to overview</Link>
      </div>
    )
  }
  return <Outlet />
}
