import { Routes, Route, Navigate, Link } from 'react-router-dom'
import Layout from './components/layout/Layout.jsx'

// Customer
import Dashboard from './pages/customer/Dashboard.jsx'
import Accounts from './pages/customer/Accounts.jsx'
import Transfer from './pages/customer/Transfer.jsx'
import Transactions from './pages/customer/Transactions.jsx'
import Notifications from './pages/customer/Notifications.jsx'

// Admin
import AdminDashboard from './pages/admin/AdminDashboard.jsx'
import AdminAccounts from './pages/admin/AdminAccounts.jsx'
import AdminTransactions from './pages/admin/AdminTransactions.jsx'
import FraudAlerts from './pages/admin/FraudAlerts.jsx'
import AuditLog from './pages/admin/AuditLog.jsx'
import ServiceHealth from './pages/admin/ServiceHealth.jsx'

function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <p className="text-6xl font-black text-slate-200">404</p>
      <p className="mt-2 text-lg font-semibold text-slate-700">Page not found</p>
      <Link to="/" className="btn-primary mt-4">Back to overview</Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Customer */}
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/transfer" element={<Transfer />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/notifications" element={<Notifications />} />

        {/* Admin */}
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/accounts" element={<AdminAccounts />} />
        <Route path="/admin/transactions" element={<AdminTransactions />} />
        <Route path="/admin/fraud" element={<FraudAlerts />} />
        <Route path="/admin/audit" element={<AuditLog />} />
        <Route path="/admin/services" element={<ServiceHealth />} />

        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Route>
    </Routes>
  )
}
