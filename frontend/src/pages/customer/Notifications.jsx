import { useMemo, useState } from 'react'
import { ShieldCheck, Receipt, Landmark, Sparkles, CheckCheck, BellOff, RefreshCw, Check, Inbox } from 'lucide-react'
import { PageHeader, Card, EmptyState, LoadingState, ErrorState, Spinner, Segmented } from '../../components/ui/Primitives.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { relativeTime, formatTime, formatDate } from '../../lib/format.js'

const TYPE_META = {
  transaction: { icon: Receipt, label: 'Transactions', tone: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300' },
  security: { icon: ShieldCheck, label: 'Security', tone: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300' },
  account: { icon: Landmark, label: 'Account', tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' },
  promo: { icon: Sparkles, label: 'Offers', tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300' },
}

function bucketOf(date) {
  const d = new Date(date)
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(new Date()) - start(d)) / 86400000)
  return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : 'Earlier'
}

export default function Notifications() {
  const {
    notifications, notificationsLoading, notificationsError, refreshNotifications,
    markAllRead, markRead, unreadCount,
  } = useApp()
  const [filter, setFilter] = useState('all')

  const initialLoad = notificationsLoading && notifications.length === 0
  const countOf = (type) => notifications.filter((n) => n.type === type).length

  const options = [
    { value: 'all', label: 'All', count: notifications.length },
    { value: 'unread', label: 'Unread', count: unreadCount },
    ...Object.entries(TYPE_META).filter(([type]) => countOf(type) > 0).map(([type, m]) => ({ value: type, label: m.label, count: countOf(type) })),
  ]

  const groups = useMemo(() => {
    const list = notifications.filter((n) => (filter === 'all' ? true : filter === 'unread' ? !n.read : n.type === filter))
    const out = { Today: [], Yesterday: [], Earlier: [] }
    list.forEach((n) => out[bucketOf(n.date)].push(n))
    return Object.entries(out).filter(([, items]) => items.length > 0)
  }, [notifications, filter])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread. Sent by notification-service when account and transaction events happen.` : 'You’re all caught up.'}
        action={
          <>
            <button type="button" className="btn-ghost" onClick={refreshNotifications} disabled={notificationsLoading} aria-label="Refresh notifications">
              {notificationsLoading ? <Spinner /> : <RefreshCw size={16} />} <span className="hidden sm:inline">Refresh</span>
            </button>
            <button type="button" className="btn-primary" onClick={markAllRead} disabled={unreadCount === 0}>
              <CheckCheck size={16} /> Mark all read
            </button>
          </>
        }
      />

      {!notificationsError && !initialLoad && notifications.length > 0 && (
        <div className="-mx-1 overflow-x-auto px-1 scrollbar-thin">
          <Segmented options={options} value={filter} onChange={setFilter} />
        </div>
      )}

      {notificationsError ? (
        <Card><ErrorState error={notificationsError} onRetry={refreshNotifications} title="Couldn't load notifications" /></Card>
      ) : initialLoad ? (
        <Card><LoadingState label="Loading notifications…" rows={5} /></Card>
      ) : notifications.length === 0 ? (
        <Card><EmptyState icon={BellOff} title="No notifications yet" message="Payment confirmations, security alerts and account updates will show up here." /></Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title={filter === 'unread' ? 'Inbox zero' : 'Nothing here'}
            message={filter === 'unread' ? 'You have read every notification. Nice.' : 'No notifications of this type yet.'}
            action={<button type="button" className="btn-ghost" onClick={() => setFilter('all')}>Show all</button>}
          />
        </Card>
      ) : (
        groups.map(([label, items]) => (
          <section key={label} aria-label={label}>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</h2>
            <Card className="overflow-hidden">
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {items.map((n) => {
                  const meta = TYPE_META[n.type] || TYPE_META.account
                  const Icon = meta.icon
                  return (
                    <li key={n.id} className={`group relative flex items-start gap-4 px-5 py-4 transition-colors ${n.read ? '' : 'bg-brand-50/50 dark:bg-brand-500/[0.06]'}`}>
                      {!n.read && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-500" aria-hidden />}
                      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${meta.tone}`}><Icon size={19} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <p className={`text-sm ${n.read ? 'font-medium text-slate-700 dark:text-slate-200' : 'heading font-semibold'}`}>{n.title}</p>
                          {!n.read && <span className="h-2 w-2 rounded-full bg-brand-500" aria-label="Unread" />}
                        </div>
                        <p className="muted mt-0.5 whitespace-pre-line text-sm leading-relaxed">{n.message}</p>
                        <p className="mt-1.5 text-[11px] text-slate-400">
                          <time dateTime={n.date} title={`${formatDate(n.date)}, ${formatTime(n.date)}`}>{label === 'Earlier' ? `${formatDate(n.date, { day: 'numeric', month: 'short' })}, ${formatTime(n.date)}` : relativeTime(n.date)}</time>
                          {[meta.label, n.channel, n.status].filter(Boolean).map((x) => <span key={x}> · {x}</span>)}
                        </p>
                      </div>
                      {!n.read && (
                        <button type="button" onClick={() => markRead(n.id)} className="btn-ghost shrink-0 px-2.5 py-1 text-xs" aria-label={`Mark "${n.title}" as read`}>
                          <Check size={14} /> <span className="hidden sm:inline">Mark read</span>
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Card>
          </section>
        ))
      )}
    </div>
  )
}
