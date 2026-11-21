import { useMemo, useState } from 'react'
import { Search, ScrollText, RefreshCw } from 'lucide-react'
import { PageHeader, Card, Badge, EmptyState, AsyncView, Spinner } from '../../components/ui/Primitives.jsx'
import { useAsync } from '../../lib/useAsync.js'
import { listAuditLogs } from '../../services/auditService.js'
import { formatDate, formatTime } from '../../lib/format.js'

const serviceTone = {
  'account-service': 'brand',
  'transaction-service': 'blue',
  'fraud-service': 'red',
  'audit-service': 'slate',
  'notification-service': 'amber',
  'api-gateway': 'green',
}

const severityTone = { INFO: 'slate', WARNING: 'amber', CRITICAL: 'red' }

export default function AuditLog() {
  const state = useAsync(() => listAuditLogs(), [])

  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle="Immutable event trail recorded by the audit-service."
        action={
          <button className="btn-ghost" onClick={state.reload} disabled={state.loading}>
            {state.loading ? <Spinner /> : <RefreshCw size={16} />} Refresh
          </button>
        }
      />
      <AsyncView state={state} card loadingLabel="Loading audit events…" errorTitle="Couldn't load the audit log">
        {(logs) => <LogList logs={logs} />}
      </AsyncView>
    </>
  )
}

function LogList({ logs }) {
  const [query, setQuery] = useState('')
  const [service, setService] = useState('all')
  const [severity, setSeverity] = useState('all')

  const services = useMemo(() => ['all', ...new Set(logs.map((l) => l.service))], [logs])

  const rows = useMemo(() => {
    const q = query.toLowerCase()
    return logs.filter((l) => {
      if (service !== 'all' && l.service !== service) return false
      if (severity !== 'all' && l.severity !== severity) return false
      if (q) return [l.action, l.entity, l.actor, l.detail, l.correlationId].some((s) => String(s || '').toLowerCase().includes(q))
      return true
    })
  }, [logs, query, service, severity])

  return (
    <>
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search event, entity, actor, correlation ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="input sm:w-56" value={service} onChange={(e) => setService(e.target.value)}>
            {services.map((s) => <option key={s} value={s}>{s === 'all' ? 'All services' : s}</option>)}
          </select>
          <select className="input sm:w-40" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="all">All severities</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {rows.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
              <div className="flex w-32 shrink-0 flex-col">
                <span className="text-sm font-medium text-slate-700">{formatTime(l.timestamp)}</span>
                <span className="text-xs text-slate-400">{formatDate(l.timestamp, { month: 'short', day: 'numeric' })}</span>
              </div>
              <div className="flex w-48 shrink-0 flex-wrap gap-1">
                <Badge tone={serviceTone[l.service] || 'slate'}>{l.service}</Badge>
                {l.severity !== 'INFO' && <Badge tone={severityTone[l.severity] || 'slate'}>{l.severity}</Badge>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-semibold text-slate-800">{l.action}</p>
                <p className="break-words text-sm text-slate-500">{l.detail}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-xs text-slate-500" title={l.entity}>{l.entity}</p>
                <p className="text-xs text-slate-400">actor: {l.actor}</p>
              </div>
            </li>
          ))}
        </ul>
        {rows.length === 0 && (
          <EmptyState
            icon={ScrollText}
            title={logs.length === 0 ? 'No audit events yet' : 'No entries'}
            message={logs.length === 0 ? 'Events from account, transaction and fraud services will appear here.' : 'No audit events match your filters.'}
          />
        )}
      </Card>
    </>
  )
}
