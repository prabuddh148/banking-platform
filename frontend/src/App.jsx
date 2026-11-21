import { lazy } from 'react'
import { Routes, Route, Navigate, Link } from 'react-router-dom'
import Layout from './components/layout/Layout.jsx'
import { RequireAuth, RequireAdmin } from './components/auth/RouteGuards.jsx'
import Login from './pages/Login.jsx'

// Pages are code-split: each one downloads the first time it is opened, so the
// login screen loads fast. Layout wraps <Outlet/> in <Suspense>.

// Customer
const Dashboard = lazy(() => import('./pages/customer/Dashboard.jsx'))
const Accounts = lazy(() => import('./pages/customer/Accounts.jsx'))
const Transfer = lazy(() => import('./pages/customer/Transfer.jsx'))
const Transactions = lazy(() => import('./pages/customer/Transactions.jsx'))
const Notifications = lazy(() => import('./pages/customer/Notifications.jsx'))

// Admin
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'))
const AdminAccounts = lazy(() => import('./pages/admin/AdminAccounts.jsx'))
const AdminTransactions = lazy(() => import('./pages/admin/AdminTransactions.jsx'))
const FraudAlerts = lazy(() => import('./pages/admin/FraudAlerts.jsx'))
const AuditLog = lazy(() => import('./pages/admin/AuditLog.jsx'))
const ServiceHealth = lazy(() => import('./pages/admin/ServiceHealth.jsx'))
const EventStream = lazy(() => import('./pages/admin/EventStream.jsx'))

// Platform
const Architecture = lazy(() => import('./pages/Architecture.jsx'))

function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <p className="bg-gradient-to-br from-brand-500 to-violet-500 bg-clip-text text-7xl font-black text-transparent">404</p>
      <p className="heading mt-2 text-lg font-semibold">Page not found</p>
      <p className="muted mt-1 text-sm">The page you're looking for doesn't exist.</p>
      <Link to="/" className="btn-primary mt-5">Back to overview</Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Everything else needs a logged-in user */}
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          {/* Customer */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/transfer" element={<Transfer />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/notifications" element={<Notifications />} />

          {/* Platform (everyone) */}
          <Route path="/architecture" element={<Architecture />} />

          {/* Admin (ROLE_ADMIN only) */}
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/accounts" element={<AdminAccounts />} />
            <Route path="/admin/transactions" element={<AdminTransactions />} />
            <Route path="/admin/fraud" element={<FraudAlerts />} />
            <Route path="/admin/events" element={<EventStream />} />
            <Route path="/admin/audit" element={<AuditLog />} />
            <Route path="/admin/services" element={<ServiceHealth />} />
          </Route>

          <Route path="/404" element={<NotFound />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
