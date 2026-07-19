import { useMemo, useState } from 'react'
import { Search, ScrollText } from 'lucide-react'
import { PageHeader, Card, Badge, EmptyState } from '../../components/ui/Primitives.jsx'
import { auditLog } from '../../data/mockData.js'
import { formatDate, formatTime } from '../../lib/format.js'

const serviceTone = {
  'account-service': 'brand',
  'transaction-service': 'blue',
  'fraud-service': 'red',
  'audit-service': 'slate',
  'notification-service': 'amber',
  'api-gateway': 'green',
}

export default function AuditLog() {
  const [query, setQuery] = useState('')
  const [service, setService] = useState('all')

  const services = ['all', ...new Set(auditLog.map((l) => l.service))]

  const rows = useMemo(() => {
    return auditLog.filter((l) => {
      if (service !== 'all' && l.service !== service) return false
      if (query) {
        const q = query.toLowerCase()
        return (
          l.action.toLowerCase().includes(q) ||
          l.entity.toLowerCase().includes(q) ||
          l.actor.toLowerCase().includes(q) ||
          l.detail.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [query, service])

  return (
    <>
      <PageHeader title="Audit Log" subtitle="Immutable event trail emitted by the audit-service." />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search action, entity, actor…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="input sm:w-56" value={service} onChange={(e) => setService(e.target.value)}>
            {services.map((s) => <option key={s} value={s}>{s === 'all' ? 'All services' : s}</option>)}
          </select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {rows.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
              <div className="flex w-40 shrink-0 flex-col">
                <span className="text-sm font-medium text-slate-700">{formatTime(l.timestamp)}</span>
                <span className="text-xs text-slate-400">{formatDate(l.timestamp, { month: 'short', day: 'numeric' })}</span>
              </div>
              <div className="w-44 shrink-0">
                <Badge tone={serviceTone[l.service] || 'slate'}>{l.service}</Badge>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-semibold text-slate-800">{l.action}</p>
                <p className="text-sm text-slate-500">{l.detail}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-xs text-slate-500">{l.entity}</p>
                <p className="text-xs text-slate-400">actor: {l.actor}</p>
              </div>
            </li>
          ))}
        </ul>
        {rows.length === 0 && <EmptyState icon={ScrollText} title="No entries" message="No audit events match your filters." />}
      </Card>
    </>
  )
}
