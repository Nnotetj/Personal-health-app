// Personal Health Profile sheet (ไทย + อังกฤษในไฟล์เดียว)
// รูปแบบข้อมูลที่บันทึกใน patient_summaries (language = 'bi'):
// {
//   allergy, family_history,
//   medications: [{ name, use, status }],
//   problems:    [{ title_en, title_th, level: 'high'|'medium'|'low', evidence }],
//   plan:        [{ problem: n | 0, items: [{ type, action, target, follow_up }] }],   // n = ลำดับใน problems (เริ่มที่ 1), 0 = ทั่วไป
//   followup:    [{ when, item, problems: [n...] }]
// }
import { DOMAINS, planToText, problemsToText } from './constants'

export const LEVELS = {
  high: { th: 'สูง', en: 'High' },
  medium: { th: 'ปานกลาง', en: 'Medium' },
  low: { th: 'ต่ำ', en: 'Low' },
}
export const levelLabel = (l) => `${LEVELS[l]?.th || LEVELS.medium.th} (${LEVELS[l]?.en || LEVELS.medium.en})`

export const PLAN_TYPES = ['ยา', 'อาหารเสริม', 'โภชนาการ', 'วิถีชีวิต', 'ตรวจติดตาม', 'ส่งต่อ', 'อื่น ๆ']

const sectionText = (sections, cat) => sections.find((s) => s.category === cat)?.content || ''

// Domain (อังกฤษ) -> ประเภท (ไทย)
function thaiType(domain) {
  const d = String(domain || '').toLowerCase()
  if (/medic|drug|ยา$|^ยา/.test(d)) return 'ยา'
  if (/supplement|vitamin|อาหารเสริม/.test(d)) return 'อาหารเสริม'
  if (/nutrition|diet|food|โภชนา/.test(d)) return 'โภชนาการ'
  if (/exercise|sleep|stress|lifestyle|วิถี/.test(d)) return 'วิถีชีวิต'
  if (/follow|test|monitor|ตรวจ/.test(d)) return 'ตรวจติดตาม'
  if (/referral|refer|ส่งต่อ/.test(d)) return 'ส่งต่อ'
  return 'อื่น ๆ'
}

function parseProblems(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^\d+[.)]\s*(.*)$/)
    const [head, ...rest] = (m ? m[1] : line).split(' — ')
    const lv = head.match(/\((High|Medium|Low)\)\s*$/i)
    return {
      title_en: head.replace(/\s*\((High|Medium|Low)\)\s*$/i, '').trim(),
      title_th: '',
      level: lv ? lv[1].toLowerCase() : 'medium',
      evidence: rest.join(' — ').trim(),
    }
  })
}

// "1. ชื่อปัญหา" / "General" ตามด้วย "- Domain: action | Target: … | เวลา"
function parsePlan(text) {
  const groups = new Map()
  let cur = 0
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const head = line.match(/^(\d+)[.)]\s+/)
    if (head && !line.startsWith('-')) { cur = Number(head[1]); continue }
    if (/^general$/i.test(line)) { cur = 0; continue }
    const legacy = line.match(/^\[(?:#\s*(\d+)|[^\]]*)\]\s*(.*)$/)
    const n = legacy ? Number(legacy[1] || 0) : cur
    const parts = (legacy ? legacy[2] : line.replace(/^[-•*]\s*/, '')).split(' | ').map((x) => x.trim())
    const dm = parts[0].match(/^([^:]{1,25}):\s*(.*)$/)
    const target = parts.find((x, i) => i > 0 && /^target\s*:/i.test(x))?.replace(/^target\s*:\s*/i, '') || ''
    const follow = parts.filter((x, i) => i > 0 && !/^target\s*:/i.test(x)).join(', ')
    if (!groups.has(n)) groups.set(n, [])
    groups.get(n).push({ type: thaiType(dm ? dm[1] : ''), action: dm ? dm[2] : parts[0], target, follow_up: follow })
  }
  return [...groups.entries()].sort((a, b) => (a[0] || 999) - (b[0] || 999)).map(([problem, items]) => ({ problem, items }))
}

// เรียงช่วงเวลา: สัปดาห์ < เดือน < ปี (ใช้ตัวเลขแรกในข้อความ)
function periodDays(s) {
  const t = String(s || '')
  const n = Number((t.match(/(\d+(?:\.\d+)?)/) || [])[1] || 1)
  if (/ทุกปี|annual|yearly|every year/i.test(t)) return 365
  if (/สัปดาห์|week/i.test(t)) return n * 7
  if (/เดือน|month/i.test(t)) return n * 30
  if (/ปี|year/i.test(t)) return n * 365
  if (/วัน|day/i.test(t)) return n
  return 10000
}
const isOngoing = (s) => !s || /ต่อเนื่อง|ongoing|continu|ตลอด|now|ทันที/i.test(s)

export function buildFollowup(problems, plan) {
  const rows = []
  for (const g of plan) {
    for (const it of g.items) {
      if (isOngoing(it.follow_up)) continue
      rows.push({ when: it.follow_up, item: it.action, problems: g.problem ? [g.problem] : [] })
    }
  }
  rows.sort((a, b) => periodDays(a.when) - periodDays(b.when))
  return rows
}

// สร้างจากโปรไฟล์ตรง ๆ (ไม่ใช้ AI): ไทยจะว่าง ต้องกดให้ AI เติมหรือพิมพ์เอง
export function buildSheetFromData({ problems = [], plan = [], sections = [] }) {
  const listText = sectionText(sections, 'problem_list') || problemsToText(problems)
  const planText = sectionText(sections, 'plan_text') || planToText(plan, problems)
  const clinical = sectionText(sections, 'clinical')
  const line = (re) => (clinical.split('\n').find((l) => re.test(l)) || '').replace(/^-\s*/, '').replace(/^[^:]+:\s*/, '').trim()
  const meds = line(/^-?\s*Current medication/i)
    .split(/,\s*(?![^(]*\))/).map((x) => x.replace(/\.$/, '').trim()).filter(Boolean)
    .map((name) => ({ name, use: '', status: '' }))
  const parsedProblems = parseProblems(listText)
  const parsedPlan = parsePlan(planText)
  return {
    allergy: '',
    family_history: line(/^-?\s*Family history/i),
    medications: meds,
    problems: parsedProblems,
    plan: parsedPlan,
    followup: buildFollowup(parsedProblems, parsedPlan),
  }
}

// กันพลาดกับผลจาก AI / ข้อมูลที่บันทึกไว้
export function normalizeSheet(s) {
  if (!s || typeof s !== 'object') return null
  const arr = (x) => (Array.isArray(x) ? x : [])
  return {
    allergy: s.allergy || '',
    family_history: s.family_history || '',
    medications: arr(s.medications).map((m) => ({ name: m.name || '', use: m.use || '', status: m.status || '' })),
    problems: arr(s.problems).map((p) => ({
      title_en: p.title_en || '', title_th: p.title_th || '',
      level: LEVELS[p.level] ? p.level : 'medium', evidence: p.evidence || '',
    })),
    plan: arr(s.plan).map((g) => ({
      problem: Number(g.problem) || 0,
      items: arr(g.items).map((i) => ({
        type: i.type || 'อื่น ๆ', action: i.action || '', target: i.target || '', follow_up: i.follow_up || '',
      })),
    })),
    followup: arr(s.followup).map((f) => ({ when: f.when || '', item: f.item || '', problems: arr(f.problems).map(Number).filter(Boolean) })),
  }
}

// ข้อมูลที่ส่งให้ AI
export function sheetProfileForAI({ patient, visit, sections = [], problems = [], plan = [] }, age) {
  const listText = sectionText(sections, 'problem_list') || problemsToText(problems)
  const planText = sectionText(sections, 'plan_text') || planToText(plan, problems)
  return {
    sex: patient.sex, age,
    background: patient.background || '',
    clinical: sectionText(sections, 'clinical'),
    integrated: sectionText(sections, 'integrated'),
    problem_list: listText,
    plan: planText,
  }
}

export const domainLabel = (d) => DOMAINS[d]?.label || d
