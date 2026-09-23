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
export const PLAN_TEXT = { key: 'plan_text', name: 'Plan of management', hint: '1 บรรทัดต่อ 1 แผน' }

// แปลงปัญหา/แผนแบบตารางเดิม (ข้อมูลเก่า) เป็นข้อความ
export function problemsToText(problems) {
  return [...problems].sort(prioritySort).map((p, i) =>
    `${i + 1}. ${p.title}${PRIORITIES[p.priority] ? ` (${PRIORITIES[p.priority].label})` : ''}${p.detail ? ` — ${p.detail}` : ''}`).join('\n')
}
export function planToText(plan, problems) {
  const order = [...problems].sort(prioritySort).map((p) => p.id)
  return plan.map((x) => {
    const n = order.indexOf(x.problem_id)
    return `${n >= 0 ? `[#${n + 1}] ` : ''}${DOMAINS[x.domain]?.label || 'Other'}: ${x.action}${x.target ? ` | Target: ${x.target}` : ''}${x.timeframe ? ` | ${x.timeframe}` : ''}`
  }).join('\n')
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
export function buildSummaryFromData({ problems, plan, sections = [] }, lang) {
  const t = T[lang]
  const listText = sections.find((x) => x.category === 'problem_list')?.content || ''
  if (!problems.length && listText.trim()) {
    const lines = listText.split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean)
    return {
      intro: '',
      themes: lines.slice(0, 6).map((l) => { const [title, ...rest] = l.split(' — '); return { title, body: [rest.join(' — ')], plan: '' } }),
      goals: lines.slice(0, 3).map((l, i) => ({ label: t.goalLabels[i], text: l.split(' — ')[0] })),
      follow_up: '', closing: '',
    }
  }
  const top = [...problems].sort(prioritySort)
  const actionsFor = (id) => plan.filter((p) => p.problem_id === id && p.domain !== 'follow_up_test').map((p) => p.action)
  return {
    intro: top.length
      ? (lang === 'th'
        ? `ผลตรวจครั้งนี้มี ${top.length} เรื่องหลักที่ควรดูแล โดยเริ่มจาก “${top[0].title}”`
        : `Your health check shows ${top.length} main areas to work on, starting with “${top[0].title}”.`)
      : '',
    themes: top.slice(0, 6).map((p) => ({ title: p.title, body: [p.detail || ''], plan: actionsFor(p.id).join(', ') })),
    goals: top.slice(0, 3).map((p, i) => ({ label: t.goalLabels[i], text: p.title })),
    follow_up: plan.filter((p) => p.domain === 'follow_up_test' || p.domain === 'referral').map((p) => p.action).join(', '),
    closing: '',
  }
}

// แปลงสรุปรูปแบบเก่า (headline / priorities / plan / next_steps) ที่บันทึกไว้แล้วให้แสดงได้
export function toProfileShape(c, lang) {
  if (!c || c.themes) return c
  const t = T[lang]
  return {
    intro: c.headline || '',
    themes: (c.priorities || []).map((p) => ({ title: p.title, body: [p.why || ''], plan: '' })),
    goals: (c.priorities || []).slice(0, 3).map((p, i) => ({ label: t.goalLabels[i], text: p.title })),
    follow_up: (c.next_steps || []).map((n) => [n.what, n.when].filter(Boolean).join(' ')).join(', '),
    closing: '',
  }
}

// นับคำ (รองรับภาษาไทยที่ไม่มีช่องว่าง)
export function countWords(c) {
  if (!c) return 0
  const text = [c.intro, ...(c.themes || []).flatMap((x) => [x.title, ...(x.body || []), x.plan]),
    ...(c.goals || []).map((g) => g.text), c.follow_up, c.closing].filter(Boolean).join(' ')
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
