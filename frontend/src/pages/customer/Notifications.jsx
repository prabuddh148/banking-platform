import { ShieldCheck, Receipt, Landmark, Sparkles, CheckCheck, BellOff } from 'lucide-react'
import { PageHeader, Card, EmptyState } from '../../components/ui/Primitives.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { relativeTime } from '../../lib/format.js'

const typeMeta = {
  security: { icon: ShieldCheck, tone: 'bg-rose-50 text-rose-600' },
  transaction: { icon: Receipt, tone: 'bg-brand-50 text-brand-600' },
  account: { icon: Landmark, tone: 'bg-emerald-50 text-emerald-600' },
  promo: { icon: Sparkles, tone: 'bg-amber-50 text-amber-600' },
}

export default function Notifications() {
  const { notifications, markAllRead, markRead, unreadCount } = useApp()

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'You’re all caught up.'}
        action={
          <button className="btn-ghost" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck size={16} /> Mark all read
          </button>
        }
      />

      <Card className="overflow-hidden">
        {notifications.length === 0 ? (
          <EmptyState icon={BellOff} title="No notifications" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {notifications.map((n) => {
              const meta = typeMeta[n.type] || typeMeta.account
              const Icon = meta.icon
              return (
                <li
                  key={n.id}
                  onClick={() => markRead(n.id)}
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
                    <p className="mt-0.5 text-sm text-slate-500">{n.message}</p>
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
