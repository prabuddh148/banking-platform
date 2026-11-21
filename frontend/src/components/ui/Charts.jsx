// Hand-rolled SVG charts (no charting library). Rules followed (see the dataviz guide):
//  - colors come from CSS variables --series-1..8 (light/dark steps), assigned in fixed order
//  - one y-axis only; recessive gridlines; 2px lines; bars with rounded data-ends
//  - every plot has a hover layer (crosshair + tooltip on lines, per-mark tooltip on bars/slices)
//  - >= 2 series always get a legend; text uses ink colors, never the series color
import { useLayoutEffect, useMemo, useRef, useState } from 'react'

export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)

/** Measures the width of the element the ref is attached to. */
function useWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return undefined
    const el = ref.current
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** "Nice" axis ticks between 0 (or min) and max. */
function niceTicks(min, max, count = 4) {
  if (max === min) max = min + 1
  const span = max - min
  const step0 = span / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)))
  return ticks
}

/** Compact number for axis labels: 12.5K, 3.2M, 1.1Cr style kept simple (K/M/B). */
export function compactNumber(n) {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`
  return String(Math.round(n * 100) / 100)
}

export function Legend({ items, className = '' }) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300 ${className}`}>
      {items.map((it, i) => (
        <li key={it.name} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color || SERIES[i] }} />
          {it.name}
        </li>
      ))}
    </ul>
  )
}

function Tooltip({ x, y, width, children }) {
  // keep the tooltip inside the chart horizontally
  const left = Math.min(Math.max(x, 70), Math.max(width - 70, 70))
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lift dark:border-white/10 dark:bg-ink-800"
      style={{ left, top: y - 8 }}
    >
      {children}
    </div>
  )
}

/**
 * Line/area chart over time.
 * series: [{ name, values: number[], color? }], labels: string[] (same length as values)
 */
export function AreaChart({ series, labels, height = 220, format = compactNumber, axisFormat = compactNumber, showLegend, fill = true, zeroBased = true }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const pad = { top: 12, right: 12, bottom: 26, left: 44 }
  const n = labels.length
  const all = series.flatMap((s) => s.values)
  // zeroBased=false zooms the y-axis to the data (e.g. a balance that moves within a narrow band)
  const dataMin = Math.min(...all)
  const min = zeroBased ? Math.min(0, dataMin) : dataMin - (Math.max(...all) - dataMin) * 0.15
  const max = Math.max(...all, 1)
  const ticks = niceTicks(min, max)
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const w = Math.max(width - pad.left - pad.right, 10)
  const h = height - pad.top - pad.bottom
  const x = (i) => pad.left + (n <= 1 ? w / 2 : (i / (n - 1)) * w)
  const y = (v) => pad.top + h - ((v - yMin) / (yMax - yMin || 1)) * h
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))))
  const legend = showLegend ?? series.length >= 2

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left - pad.left
    const i = Math.round((px / w) * (n - 1))
    setHover(Math.min(n - 1, Math.max(0, i)))
  }

  return (
    <div>
      {legend && <Legend className="mb-3" items={series.map((s, i) => ({ name: s.name, color: s.color || SERIES[i] }))} />}
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.name).join(', ')}>
            <defs>
              {series.map((s, si) => (
                <linearGradient key={si} id={`area-${si}-${s.name.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color || SERIES[si]} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={s.color || SERIES[si]} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[10px] tabular">{axisFormat(t)}</text>
              </g>
            ))}
            {labels.map((l, i) => (i % labelEvery === 0 || i === n - 1) && (
              <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-slate-400 text-[10px]">{l}</text>
            ))}
            {series.map((s, si) => {
              const color = s.color || SERIES[si]
              const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
              return (
                <g key={s.name}>
                  {fill && <polygon points={`${x(0)},${y(yMin)} ${pts} ${x(n - 1)},${y(yMin)}`} fill={`url(#area-${si}-${s.name.replace(/\W/g, '')})`} />}
                  <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </g>
              )
            })}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + h} stroke="var(--chart-axis)" strokeDasharray="3 3" />
                {series.map((s, si) => (
                  <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="4.5" fill={s.color || SERIES[si]} stroke="var(--chart-surface)" strokeWidth="2" />
                ))}
              </g>
            )}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <Tooltip x={x(hover)} y={Math.min(...series.map((s) => y(s.values[hover])))} width={width}>
            <p className="mb-1 font-semibold text-slate-700 dark:text-slate-200">{labels[hover]}</p>
            {series.map((s, si) => (
              <p key={s.name} className="flex items-center justify-between gap-4 text-slate-600 dark:text-slate-300">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color || SERIES[si] }} />{s.name}</span>
                <span className="tabular font-semibold text-slate-900 dark:text-white">{format(s.values[hover])}</span>
              </p>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  )
}

/**
 * Vertical bars, one or more series side by side.
 * series: [{ name, values, color? }], labels: string[]
 */
export function ColumnChart({ series, labels, height = 220, format = compactNumber, axisFormat = compactNumber, showLegend }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null) // { i, si }
  const pad = { top: 12, right: 8, bottom: 26, left: 44 }
  const n = labels.length
  const ticks = niceTicks(0, Math.max(...series.flatMap((s) => s.values), 1))
  const yMax = ticks[ticks.length - 1]
  const w = Math.max(width - pad.left - pad.right, 10)
  const h = height - pad.top - pad.bottom
  const band = w / n
  const groupW = band * 0.68
  const gap = 2
  const barW = Math.max(2, (groupW - gap * (series.length - 1)) / series.length)
  const y = (v) => pad.top + h - (v / (yMax || 1)) * h
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 48))))
  const legend = showLegend ?? series.length >= 2
  const r = Math.min(4, barW / 2)

  // bar path with rounded top corners, square at the baseline
  const barPath = (bx, by, bw, bh) => {
    const rr = Math.min(r, bh)
    return `M${bx},${by + bh} V${by + rr} Q${bx},${by} ${bx + rr},${by} H${bx + bw - rr} Q${bx + bw},${by} ${bx + bw},${by + rr} V${by + bh} Z`
  }

  return (
    <div>
      {legend && <Legend className="mb-3" items={series.map((s, i) => ({ name: s.name, color: s.color || SERIES[i] }))} />}
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} onMouseLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.name).join(', ')}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[10px] tabular">{axisFormat(t)}</text>
              </g>
            ))}
            {labels.map((l, i) => (i % labelEvery === 0) && (
              <text key={i} x={pad.left + band * i + band / 2} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">{l}</text>
            ))}
            {labels.map((_, i) => {
              const gx = pad.left + band * i + (band - groupW) / 2
              return (
                <g key={i}>
                  {/* wide invisible hit target per group */}
                  <rect x={pad.left + band * i} y={pad.top} width={band} height={h} fill="transparent" onMouseEnter={() => setHover({ i })} />
                  {series.map((s, si) => {
                    const v = s.values[i] || 0
                    const bh = Math.max(v > 0 ? 1.5 : 0, y(0) - y(v))
                    const dim = hover && hover.i !== i
                    return (
                      <path key={si} d={barPath(gx + si * (barW + gap), y(0) - bh, barW, bh)} fill={s.color || SERIES[si]} opacity={dim ? 0.45 : 1} className="pointer-events-none transition-opacity" />
                    )
                  })}
                </g>
              )
            })}
          </svg>
        )}
        {hover && width > 0 && (
          <Tooltip x={pad.left + band * hover.i + band / 2} y={y(Math.max(...series.map((s) => s.values[hover.i] || 0)))} width={width}>
            <p className="mb-1 font-semibold text-slate-700 dark:text-slate-200">{labels[hover.i]}</p>
            {series.map((s, si) => (
              <p key={s.name} className="flex items-center justify-between gap-4 text-slate-600 dark:text-slate-300">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color || SERIES[si] }} />{s.name}</span>
                <span className="tabular font-semibold text-slate-900 dark:text-white">{format(s.values[hover.i] || 0)}</span>
              </p>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  )
}

/**
 * Donut with a legend table (label, value, share). items: [{ label, value }].
 * More than 6 slices fold into "Other" (no generated colors).
 */
export function DonutChart({ items, format = compactNumber, size = 176, centerLabel, centerValue }) {
  const [hover, setHover] = useState(null)
  const data = useMemo(() => {
    const sorted = [...items].filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
    if (sorted.length <= 6) return sorted
    const head = sorted.slice(0, 5)
    const rest = sorted.slice(5).reduce((s, d) => s + d.value, 0)
    return [...head, { label: 'Other', value: rest }]
  }, [items])
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const r = size / 2
  const stroke = size * 0.15
  const radius = r - stroke / 2
  const C = 2 * Math.PI * radius
  const gapLen = data.length > 1 ? 2 : 0 // 2px surface gap between slices
  let acc = 0

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label="Breakdown">
          <circle cx={r} cy={r} r={radius} fill="none" stroke="var(--chart-grid)" strokeWidth={stroke} />
          {data.map((d, i) => {
            const len = (d.value / total) * C
            const dash = `${Math.max(len - gapLen, 0.5)} ${C - Math.max(len - gapLen, 0.5)}`
            const offset = -acc
            acc += len
            return (
              <circle
                key={d.label}
                cx={r} cy={r} r={radius} fill="none"
                stroke={SERIES[i]}
                strokeWidth={hover === i ? stroke + 4 : stroke}
                strokeDasharray={dash}
                strokeDashoffset={offset}
                opacity={hover !== null && hover !== i ? 0.4 : 1}
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="muted text-[11px] font-medium">{hover !== null ? data[hover].label : centerLabel}</p>
            <p className="heading tabular text-base font-bold">{hover !== null ? format(data[hover].value) : centerValue ?? format(total)}</p>
            {hover !== null && <p className="muted tabular text-[11px]">{((data[hover].value / total) * 100).toFixed(1)}%</p>}
          </div>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => (
          <li
            key={d.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm transition-colors ${hover === i ? 'bg-slate-100 dark:bg-white/5' : ''}`}
          >
            <span className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIES[i] }} />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="flex items-baseline gap-2">
              <span className="tabular font-medium text-slate-900 dark:text-white">{format(d.value)}</span>
              <span className="muted tabular w-10 text-right text-xs">{((d.value / total) * 100).toFixed(0)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Tiny trend line for KPI tiles (no axes). */
export function Sparkline({ data, height = 40, color = 'var(--series-1)', fill = true }) {
  const [ref, width] = useWidth()
  const id = useMemo(() => `spark-${Math.random().toString(36).slice(2, 8)}`, [])
  if (!Array.isArray(data) || data.length < 2) return <div style={{ height }} />
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - ((v - min) / range) * (height - 6) - 3])
  const line = pts.map((p) => p.join(',')).join(' ')
  return (
    <div ref={ref} className="w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} aria-hidden>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {fill && <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${id})`} />}
          <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={color} />
        </svg>
      )}
    </div>
  )
}

/** Simple bar strip kept for older pages: data = number[] */
export function BarChart({ data, height = 120, labels }) {
  return <ColumnChart series={[{ name: 'Value', values: data }]} labels={labels || data.map((_, i) => String(i))} height={height} showLegend={false} />
}

/** Horizontal category bars (spending breakdown). items: [{ category, amount }] */
export function CategoryBars({ items, format }) {
  const max = Math.max(...items.map((i) => i.amount), 1)
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.category} title={`${it.category}: ${format ? format(it.amount) : it.amount}`}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600 dark:text-slate-300">{it.category}</span>
            <span className="tabular font-medium text-slate-900 dark:text-white">{format ? format(it.amount) : it.amount}</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-slate-100 dark:bg-white/[0.06]">
            <div className="h-2 rounded-full" style={{ width: `${(it.amount / max) * 100}%`, background: 'var(--series-1)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Half-circle risk gauge (0-100). Status colors + a text label, never color alone.
 * Bands follow the fraud-service levels: <30 LOW, <60 MEDIUM, <80 HIGH, else CRITICAL.
 */
export function RiskGauge({ score, size = 180 }) {
  const s = Math.max(0, Math.min(100, Number(score) || 0))
  const level = s < 30 ? 'LOW' : s < 60 ? 'MEDIUM' : s < 80 ? 'HIGH' : 'CRITICAL'
  const color = { LOW: 'var(--status-good)', MEDIUM: 'var(--status-warning)', HIGH: 'var(--status-serious)', CRITICAL: 'var(--status-critical)' }[level]
  const stroke = 14
  const r = size / 2 - stroke
  const cx = size / 2
  const cy = size / 2
  const arc = (from, to) => {
    const a0 = Math.PI * (1 - from / 100)
    const a1 = Math.PI * (1 - to / 100)
    return `M${cx + r * Math.cos(a0)},${cy - r * Math.sin(a0)} A${r},${r} 0 0 1 ${cx + r * Math.cos(a1)},${cy - r * Math.sin(a1)}`
  }
  return (
    <div className="flex flex-col items-center" role="img" aria-label={`Risk score ${s} of 100, ${level}`}>
      <svg width={size} height={size / 2 + 12}>
        <path d={arc(0, 100)} fill="none" stroke="var(--chart-grid)" strokeWidth={stroke} strokeLinecap="round" />
        {s > 0 && <path d={arc(0, s)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />}
        {[30, 60, 80].map((t) => {
          const a = Math.PI * (1 - t / 100)
          return <line key={t} x1={cx + (r - stroke / 2 - 2) * Math.cos(a)} y1={cy - (r - stroke / 2 - 2) * Math.sin(a)} x2={cx + (r + stroke / 2 + 2) * Math.cos(a)} y2={cy - (r + stroke / 2 + 2) * Math.sin(a)} stroke="var(--chart-surface)" strokeWidth="2" />
        })}
      </svg>
      <div className="-mt-12 text-center">
        <p className="heading tabular text-3xl font-bold">{s}</p>
        <p className="mt-0.5 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">{level} RISK</p>
      </div>
    </div>
  )
}
