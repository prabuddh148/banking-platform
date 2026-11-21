import { ShieldCheck, Receipt, Landmark, Sparkles, CheckCheck, BellOff, RefreshCw } from 'lucide-react'
import { PageHeader, Card, EmptyState, LoadingState, ErrorState, Spinner } from '../../components/ui/Primitives.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { relativeTime } from '../../lib/format.js'

const typeMeta = {
  security: { icon: ShieldCheck, tone: 'bg-rose-50 text-rose-600' },
  transaction: { icon: Receipt, tone: 'bg-brand-50 text-brand-600' },
  account: { icon: Landmark, tone: 'bg-emerald-50 text-emerald-600' },
  promo: { icon: Sparkles, tone: 'bg-amber-50 text-amber-600' },
}

export default function Notifications() {
  const {
    notifications, notificationsLoading, notificationsError, refreshNotifications,
    markAllRead, markRead, unreadCount,
  } = useApp()

  const initialLoad = notificationsLoading && notifications.length === 0

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'You’re all caught up.'}
        action={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={refreshNotifications} disabled={notificationsLoading}>
              {notificationsLoading ? <Spinner /> : <RefreshCw size={16} />} Refresh
            </button>
            <button className="btn-ghost" onClick={markAllRead} disabled={unreadCount === 0}>
              <CheckCheck size={16} /> Mark all read
            </button>
          </div>
        }
      />

      <Card className="overflow-hidden">
        {notificationsError ? (
          <ErrorState error={notificationsError} onRetry={refreshNotifications} title="Couldn't load notifications" />
        ) : initialLoad ? (
          <LoadingState label="Loading notifications…" />
        ) : notifications.length === 0 ? (
          <EmptyState icon={BellOff} title="No notifications" message="Account and transaction updates will appear here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {notifications.map((n) => {
              const meta = typeMeta[n.type] || typeMeta.account
              const Icon = meta.icon
              return (
                <li
                  key={n.id}
                  onClick={() => !n.read && markRead(n.id)}
                  className={`flex cursor-pointer items-start gap-4 p-5 transition-colors hover:bg-slate-50 ${!n.read ? 'bg-brand-50/40' : ''}`}
                >
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${meta.tone}`}>
                    <Icon size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-800">{n.title}</p>
                      {!n.read && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                    </div>
                    <p className="mt-0.5 whitespace-pre-line text-sm text-slate-500">{n.message}</p>
                    {(n.channel || n.status) && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        {[n.channel, n.recipient, n.status].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{relativeTime(n.date)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
