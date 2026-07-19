// Small, dependency-free UI primitives used across customer + admin pages.
// Charts are hand-rolled SVG/flex so there's no charting library to install.

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Card({ children, className = '' }) {
  return <div className={`card ${className}`}>{children}</div>
}

export function StatCard({ label, value, delta, icon: Icon, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-600',
  }
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
        </div>
        {Icon && (
          <div className={`grid h-10 w-10 place-items-center rounded-lg ${tones[tone]}`}>
            <Icon size={20} />
          </div>
        )}
      </div>
      {delta && (
        <p className={`mt-3 text-xs font-medium ${delta.up ? 'text-emerald-600' : 'text-rose-600'}`}>
          {delta.up ? '▲' : '▼'} {delta.label}
        </p>
      )}
    </div>
  )
}

const badgeTones = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
}

export function Badge({ children, tone = 'slate' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeTones[tone]}`}>
      {children}
    </span>
  )
}

// Maps common status strings to a badge tone so the same component works
// for accounts, transactions, fraud cases, and services.
export function StatusBadge({ status }) {
  const map = {
    Active: 'green',
    Operational: 'green',
    Posted: 'green',
    Cleared: 'green',
    Pending: 'amber',
    Reviewing: 'amber',
    Degraded: 'amber',
    'Under Review': 'amber',
    Dormant: 'slate',
    Open: 'red',
    Blocked: 'red',
    Frozen: 'red',
    Down: 'red',
  }
  return <Badge tone={map[status] || 'slate'}>{status}</Badge>
}

// Vertical bars — used for platform volume / balance trends.
export function BarChart({ data, height = 120, color = 'bg-brand-500' }) {
  const max = Math.max(...data, 1)
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-t ${color} opacity-80 hover:opacity-100 transition-opacity`}
          style={{ height: `${Math.max((v / max) * 100, 3)}%` }}
          title={v.toLocaleString()}
        />
      ))}
    </div>
  )
}

// Smooth area sparkline via SVG polyline.
export function Sparkline({ data, height = 64, stroke = '#4f46e5' }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const w = 100
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = height - ((v - min) / range) * (height - 8) - 4
    return `${x},${y}`
  })
  const area = `0,${height} ${points.join(' ')} ${w},${height}`
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark)" />
      <polyline points={points.join(' ')} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// Horizontal category bars for the spending breakdown.
export function CategoryBars({ items, format }) {
  const max = Math.max(...items.map((i) => i.amount), 1)
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.category}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">{it.category}</span>
            <span className="font-medium text-slate-800">{format ? format(it.amount) : it.amount}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${(it.amount / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, message }) {
  return (
    <div className="grid place-items-center py-16 text-center">
      {Icon && <Icon size={40} className="text-slate-300" />}
      <p className="mt-3 font-semibold text-slate-700">{title}</p>
      {message && <p className="mt-1 text-sm text-slate-500">{message}</p>}
    </div>
  )
}
