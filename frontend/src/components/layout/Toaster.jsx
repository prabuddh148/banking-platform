import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'

const TONES = {
  success: { icon: CheckCircle2, color: 'text-emerald-500' },
  error: { icon: AlertTriangle, color: 'text-rose-500' },
  info: { icon: Info, color: 'text-brand-500' },
}

/** Bottom-right stack of toasts (see showToast in AppContext). */
export default function Toaster() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const tone = TONES[t.tone] || TONES.success
        return (
          <div key={t.id} role="status" className="card pointer-events-auto flex items-start gap-3 p-3.5 shadow-lift animate-slide-in-right dark:bg-ink-800">
            <tone.icon size={19} className={`mt-0.5 shrink-0 ${tone.color}`} />
            <div className="min-w-0 flex-1">
              <p className="heading text-sm font-semibold">{t.title}</p>
              {t.description && <p className="muted mt-0.5 text-xs leading-relaxed">{t.description}</p>}
            </div>
            <button onClick={() => dismissToast(t.id)} className="rounded-md p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
