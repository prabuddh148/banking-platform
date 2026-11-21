import { Outlet } from 'react-router-dom'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import Sidebar from './Sidebar.jsx'
import Topbar from './Topbar.jsx'
import { useApp } from '../../context/AppContext.jsx'

export default function Layout() {
  const { toast } = useApp()

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div key={toast.id} role="status" className="fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-2.5 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg animate-fade-in">
          {toast.tone === 'error'
            ? <AlertTriangle size={18} className="shrink-0 text-rose-400" />
            : <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />}
          {toast.message}
        </div>
      )}
    </div>
  )
}
