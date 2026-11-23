import { fmtDate } from '../lib/constants'
import { distanceFromRange, parseRefRange } from '../lib/catalog'

export default function Sparkline({ points, current, refRange, w = 84, h = 26 }) {
  const vals = points.map((p) => p.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const xy = points.map((p, i) => [
    4 + (i * (w - 8)) / Math.max(points.length - 1, 1),
    h - 4 - ((p.value - min) / span) * (h - 8),
  ])
  const idx = points.findIndex((p) => p.visit_id === current)
  const prev = idx > 0 ? points[idx - 1] : null
  const delta = prev ? points[idx].value - prev.value : null
  // เขียว = เข้าใกล้ค่าปกติ, แดง = ห่างออก, เทา = ไม่ต่าง หรือไม่รู้ช่วงปกติ
  const range = parseRefRange(refRange)
  const dPrev = prev ? distanceFromRange(prev.value, range) : null
  const dNow = prev ? distanceFromRange(points[idx].value, range) : null
  const trend = dPrev == null || dNow == null || dNow === dPrev ? '' : dNow < dPrev ? 'better' : 'worse'
  const title = points.map((p) => `${fmtDate(p.date)}: ${p.value}`).join('\n')

  return (
    <span className="spark" title={title}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <polyline points={xy.map((p) => p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" />
        {xy.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={points[i].visit_id === current ? 3 : 1.8}
            fill={points[i].visit_id === current ? 'var(--ink)' : 'currentColor'} />
        ))}
      </svg>
      {delta != null && <span className={`delta ${trend}`} aria-hidden="true">{delta > 0 ? '+' : ''}{+delta.toFixed(2)}</span>}
      <span className="sr-only">
        แนวโน้ม {points.map((p) => `${fmtDate(p.date)} ${p.value}`).join(', ')}
        {delta != null && `, เปลี่ยนจากครั้งก่อน ${delta > 0 ? '+' : ''}${+delta.toFixed(2)}`}
        {trend && (trend === 'better' ? ' (เข้าใกล้ค่าปกติ)' : ' (ห่างจากค่าปกติ)')}
      </span>
    </span>
  )
}
