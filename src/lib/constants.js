export const CATEGORIES = [
  {
    key: 'clinical',
    name: 'Clinical',
    th: 'ประวัติสุขภาพ',
    en: 'Health history',
    hint: 'U/D, PHx, อาการ, ยา, family history, lifestyle / exposure',
    subs: ['Underlying disease', 'Past history', 'Symptom / concern', 'Medication / supplement',
      'Family history', 'Lifestyle / exposure', 'Other'],
  },
  {
    key: 'functional',
    name: 'Functional',
    th: 'สมรรถภาพร่างกาย',
    en: 'Body function & fitness',
    hint: 'Body composition, fitness, strength, VO₂max, REE, functional capacity',
    subs: ['Body composition', 'VO₂ max', 'Grip strength', 'Fitness age', 'REE', 'HRV', 'Blood pressure',
      'Spirometry', 'CGM', 'Sleep study', 'Bone', 'Other'],
  },
  {
    key: 'biomarker',
    name: 'Biomarker',
    th: 'ผลเลือดและ biomarker',
    en: 'Blood & biomarker tests',
    hint: 'Conventional labs + advanced biomarkers (non-omics)',
    subs: ['CBC', 'Glucose / insulin', 'Lipid', 'Liver', 'Kidney', 'Electrolytes', 'Thyroid', 'Hormone',
      'Vitamin / mineral', 'Fatty acid', 'Inflammation', 'Food sensitivity', 'Tumor marker', 'Advanced biomarker',
      'Urinalysis', 'Other'],
  },
  {
    key: 'imaging',
    name: 'Imaging',
    th: 'ผลเอกซเรย์และอัลตราซาวด์',
    en: 'Scans & imaging',
    hint: 'Structural / functional imaging: US, CT, MRI, echo, CIMT, CAC, DEXA',
    subs: ['Ultrasound', 'X-ray', 'CT', 'MRI', 'Mammogram', 'DEXA', 'Echocardiogram', 'CAC score', 'Other'],
  },
  {
    key: 'multiomic',
    name: 'Multi-omics',
    th: 'ผลตรวจระดับยีนและโมเลกุล',
    en: 'Genes & molecular tests',
    hint: 'Genome, epigenome, transcriptome, proteome, metabolome, microbiome',
    subs: ['Genome', 'Epigenome', 'Transcriptome', 'Proteome', 'Metabolome', 'Microbiome'],
  },
]

// ช่องสรุปรวมท้ายโปรไฟล์ (เก็บใน visit_sections แต่ไม่ใช่หมวดของค่าตัวเลข)
export const INTEGRATED = { key: 'integrated', name: 'Integrated Profile', hint: 'ภาพรวมและลำดับความสำคัญ 2–4 ประโยค' }
export const PROBLEM_LIST = { key: 'problem_list', name: 'ปัญหาเรียงตามความสำคัญ', hint: '1 บรรทัดต่อ 1 ปัญหา เรียงจากสำคัญที่สุด' }
export const PLAN_TEXT = { key: 'plan_text', name: 'Plan of management', hint: 'จัดกลุ่มตามปัญหาด้านบน' }

// แปลงปัญหา/แผนแบบตารางเดิม (ข้อมูลเก่า) เป็นข้อความ
export function problemsToText(problems) {
  return [...problems].sort(prioritySort).map((p, i) =>
    `${i + 1}. ${p.title}${PRIORITIES[p.priority] ? ` (${PRIORITIES[p.priority].label})` : ''}${p.detail ? ` — ${p.detail}` : ''}`).join('\n')
}
export function planToText(plan, problems) {
  const order = [...problems].sort(prioritySort)
  const line = (x) => `- ${DOMAINS[x.domain]?.label || 'Other'}: ${x.action}${x.target ? ` | Target: ${x.target}` : ''}${x.timeframe ? ` | ${x.timeframe}` : ''}`
  const blocks = order.map((p, i) => {
    const items = plan.filter((x) => x.problem_id === p.id)
    return items.length ? [`${i + 1}. ${p.title}`, ...items.map(line)].join('\n') : null
  }).filter(Boolean)
  const general = plan.filter((x) => !order.some((p) => p.id === x.problem_id))
  if (general.length) blocks.push(['General', ...general.map(line)].join('\n'))
  return blocks.join('\n\n')
}

export const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]))

export const FLAGS = {
  normal: 'Normal',
  borderline: 'Borderline',
  low: 'Low',
  high: 'High',
  abnormal: 'Abnormal',
  critical: 'Critical',
}

export const PRIORITIES = {
  high: { label: 'High', th: 'ควรดูแลก่อน', en: 'Top priority' },
  medium: { label: 'Medium', th: 'ควรปรับ', en: 'Work on this' },
  low: { label: 'Low', th: 'ติดตามต่อ', en: 'Keep an eye on' },
}

export const DOMAINS = {
  nutrition: { label: 'Nutrition', th: 'อาหาร', en: 'Food' },
  exercise: { label: 'Exercise', th: 'การออกกำลังกาย', en: 'Movement' },
  sleep: { label: 'Sleep', th: 'การนอน', en: 'Sleep' },
  stress: { label: 'Stress', th: 'ความเครียด', en: 'Stress' },
  supplement: { label: 'Supplement', th: 'วิตามินและอาหารเสริม', en: 'Supplements' },
  medication: { label: 'Medication', th: 'ยา', en: 'Medicines' },
  follow_up_test: { label: 'Follow-up test', th: 'ตรวจติดตาม', en: 'Follow-up tests' },
  referral: { label: 'Referral', th: 'ส่งต่อผู้เชี่ยวชาญ', en: 'Specialist referral' },
  other: { label: 'Other', th: 'อื่น ๆ', en: 'Other' },
}

export const T = {
  th: {
    title: 'โปรไฟล์สุขภาพเฉพาะตัวของคุณ',
    date: 'วันที่ตรวจ', age: 'อายุ', years: 'ปี', hn: 'HN',
    plan: 'แผน',
    goals: 'เป้าหมายสุขภาพหลักของคุณ',
    followUp: 'ติดตามต่อเนื่อง',
    doctor: 'แพทย์ผู้ดูแล',
    disclaimer: 'เอกสารนี้สรุปจากผลตรวจเพื่อใช้ประกอบคำแนะนำของแพทย์ หากมีอาการผิดปกติโปรดติดต่อแพทย์',
    goalLabels: ['อันดับแรก', 'อันดับสอง', 'อันดับสาม'],
  },
  en: {
    title: 'My Personalized Health Profile',
    date: 'Check-up date', age: 'Age', years: 'years', hn: 'HN',
    plan: 'Plan',
    goals: 'Your Main Health Goals',
    followUp: 'Continue follow-up',
    doctor: 'Your doctor',
    disclaimer: 'This summary supports your doctor’s advice. Contact the clinic if you feel unwell.',
    goalLabels: ['First', 'Second', 'Third'],
  },
}

export function ageFrom(dob, at = new Date()) {
  if (!dob) return null
  const d = new Date(dob)
  const ref = new Date(at)
  let a = ref.getFullYear() - d.getFullYear()
  const m = ref.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && ref.getDate() < d.getDate())) a--
  return a
}

export function fmtDate(d, lang = 'th') {
  if (!d) return ''
  return new Date(d).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export const uid = () => crypto.randomUUID()

export const isAbnormal = (f) => f.flag && f.flag !== 'normal'

// Build a deterministic summary (no AI) from structured data
// รูปแบบ: { intro, themes:[{title, body:[], plan}], goals:[{label, text}], follow_up, closing }
// อ่านกล่อง Plan ของหมอ: หัวข้อ "1. ชื่อปัญหา" / "General" ตามด้วย "- Domain: action | Target: … | เวลา"
// (รองรับรูปแบบเก่า "[#1] Domain: …" ด้วย)
export function parsePlanText(text) {
  const groups = {}
  let current = 0
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const head = line.match(/^(\d+)[.)]\s+/)
    if (head) { current = Number(head[1]); continue }
    if (/^general$/i.test(line)) { current = 0; continue }
    const legacy = line.match(/^\[(?:#\s*(\d+)|[^\]]*)\]\s*(.*)$/)
    const n = legacy ? Number(legacy[1] || 0) : current
    const body = (legacy ? legacy[2] : line.replace(/^[-•*]\s*/, '')).split(' | ').map((x) => x.trim())
    const [first, ...rest] = body
    const dm = first.match(/^([^:]{1,25}):\s*(.*)$/)
    const others = rest.filter((x) => !/^target\s*:/i.test(x))
    ;(groups[n] ||= []).push({
      domain: dm ? dm[1] : '',
      action: dm ? dm[2] : first,
      when: others.join(', '),
    })
  }
  return groups
}

const isFollowUp = (d) => /follow|ตรวจติดตาม/i.test(d || '')
const stripPriority = (s) => String(s || '').replace(/\s*\((High|Medium|Low)\)\s*$/i, '').trim()

// Build a deterministic summary (no AI) from structured data
// รูปแบบ: { intro, themes:[{title, body:[], plan:[{action, when}]}], goals:[{label, text}], follow_up:[{what, when}], closing }
export function buildSummaryFromData({ problems, plan, sections = [] }, lang) {
  const t = T[lang]
  const listText = sections.find((x) => x.category === 'problem_list')?.content || ''
  if (!problems.length && listText.trim()) {
    const lines = listText.split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean)
    const groups = parsePlanText(sections.find((x) => x.category === 'plan_text')?.content)
    const follow = []
    const themes = lines.slice(0, 6).map((l, i) => {
      const [title, ...rest] = l.split(' — ')
      const items = groups[i + 1] || []
      follow.push(...items.filter((x) => isFollowUp(x.domain)))
      return { title: stripPriority(title), body: [rest.join(' — ')], plan: items.filter((x) => !isFollowUp(x.domain)).map(({ action, when }) => ({ action, when })) }
    })
    follow.push(...(groups[0] || []))
    return {
      intro: '',
      themes,
      goals: lines.slice(0, 3).map((l, i) => ({ label: t.goalLabels[i], text: stripPriority(l.split(' — ')[0]) })),
      follow_up: follow.map((x) => ({ what: x.action, when: x.when })),
      closing: '',
    }
  }
  const top = [...problems].sort(prioritySort)
  const item = (p) => ({ action: p.action, when: p.timeframe || '' })
  return {
    intro: top.length
      ? (lang === 'th'
        ? `ผลตรวจครั้งนี้มี ${top.length} เรื่องหลักที่ควรดูแล โดยเริ่มจาก “${top[0].title}”`
        : `Your health check shows ${top.length} main areas to work on, starting with “${top[0].title}”.`)
      : '',
    themes: top.slice(0, 6).map((p) => ({
      title: p.title, body: [p.detail || ''],
      plan: plan.filter((x) => x.problem_id === p.id && x.domain !== 'follow_up_test').map(item),
    })),
    goals: top.slice(0, 3).map((p, i) => ({ label: t.goalLabels[i], text: p.title })),
    follow_up: plan.filter((x) => x.domain === 'follow_up_test' || !x.problem_id)
      .map((x) => ({ what: x.action, when: x.timeframe || '' })),
    closing: '',
  }
}

// ทำให้สรุปทุกรูปแบบ (เก่า/ใหม่) แสดงได้: plan และ follow_up เป็นรายการเสมอ
function normalizeSummary(c) {
  const toPlan = (p) => (Array.isArray(p) ? p : p ? [{ action: p, when: '' }] : [])
  const toFollow = (f) => (Array.isArray(f) ? f : f ? [{ what: f, when: '' }] : [])
  return {
    ...c,
    themes: (c.themes || []).map((x) => ({ ...x, body: x.body || [], plan: toPlan(x.plan) })),
    goals: c.goals || [],
    follow_up: toFollow(c.follow_up),
  }
}

// แปลงสรุปรูปแบบเก่า (headline / priorities / plan / next_steps) ที่บันทึกไว้แล้วให้แสดงได้
export function toProfileShape(c, lang) {
  if (!c) return c
  if (c.themes) return normalizeSummary(c)
  const t = T[lang]
  return normalizeSummary({
    intro: c.headline || '',
    themes: (c.priorities || []).map((p) => ({ title: p.title, body: [p.why || ''], plan: [] })),
    goals: (c.priorities || []).slice(0, 3).map((p, i) => ({ label: t.goalLabels[i], text: p.title })),
    follow_up: (c.next_steps || []).map((n) => ({ what: n.what, when: n.when || '' })),
    closing: '',
  })
}

// นับคำ (รองรับภาษาไทยที่ไม่มีช่องว่าง)
export function countWords(c) {
  if (!c) return 0
  const planText = (p) => (Array.isArray(p) ? p.flatMap((x) => [x.action, x.when]) : [p])
  const followText = (f) => (Array.isArray(f) ? f.flatMap((x) => [x.what, x.when]) : [f])
  const text = [c.intro, ...(c.themes || []).flatMap((x) => [x.title, ...(x.body || []), ...planText(x.plan)]),
    ...(c.goals || []).map((g) => g.text), ...followText(c.follow_up), c.closing].filter(Boolean).join(' ')
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    let n = 0
    for (const s of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) if (s.isWordLike) n++
    return n
  }
  return text.split(/\s+/).filter(Boolean).length
}

export const prioritySort = (a, b) =>
  ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority) ||
  (a.sort_order ?? 0) - (b.sort_order ?? 0)
