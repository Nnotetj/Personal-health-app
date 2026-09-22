export const CATEGORIES = [
  {
    key: 'conventional',
    name: 'Conventional biomarkers',
    th: 'ผลเลือดพื้นฐาน',
    en: 'Routine blood & urine tests',
    hint: 'CBC, FBG, HbA1c, CMP, lipid, thyroid, hormone, vitamin',
    subs: ['CBC', 'Glucose / insulin', 'Lipid', 'Liver', 'Kidney', 'Electrolytes', 'Thyroid', 'Hormone',
      'Vitamin / mineral', 'Inflammation', 'Tumor marker', 'Urinalysis', 'Other'],
  },
  {
    key: 'multiomic',
    name: 'Multiomic lab',
    th: 'ผลตรวจระดับยีนและโมเลกุล',
    en: 'Genes & molecular tests',
    hint: 'Genetic, epigenetic, transcriptomic, proteomic, metabolomic, microbiomic',
    subs: ['Genetic', 'Epigenetic', 'Transcriptomic', 'Proteomic', 'Metabolomic', 'Microbiomic'],
  },
  {
    key: 'functional',
    name: 'Physiologic / functional',
    th: 'สมรรถภาพร่างกาย',
    en: 'Body function & fitness',
    hint: 'Body composition, VO₂ max, grip strength, HRV, BP, CGM',
    subs: ['Body composition', 'VO₂ max', 'Grip strength', 'HRV', 'Blood pressure', 'Spirometry', 'CGM',
      'Sleep study', 'Other'],
  },
  {
    key: 'imaging',
    name: 'Imaging',
    th: 'ผลเอกซเรย์และอัลตราซาวด์',
    en: 'Scans & imaging',
    hint: 'Ultrasound, X-ray, CT, MRI, mammogram, DEXA, echo, CAC',
    subs: ['Ultrasound', 'X-ray', 'CT', 'MRI', 'Mammogram', 'DEXA', 'Echocardiogram', 'CAC score', 'Other'],
  },
]

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
    title: 'สรุปผลสุขภาพและแผนดูแลเฉพาะคุณ',
    date: 'วันที่ตรวจ', age: 'อายุ', years: 'ปี', hn: 'HN',
    overview: 'ภาพรวม',
    numbers: 'ตัวเลขสำคัญ',
    priorities: 'สิ่งที่ควรดูแลเรียงตามความสำคัญ',
    why: 'ทำไมสำคัญ',
    plan: 'แผนการดูแล',
    next: 'นัดหมายและการตรวจครั้งต่อไป',
    doctor: 'แพทย์ผู้ดูแล',
    status: { good: 'ดี', watch: 'เฝ้าระวัง', act: 'ควรแก้ไข' },
    disclaimer: 'เอกสารนี้สรุปจากผลตรวจเพื่อใช้ประกอบคำแนะนำของแพทย์ หากมีอาการผิดปกติโปรดติดต่อแพทย์',
  },
  en: {
    title: 'Your health summary & personal plan',
    date: 'Check-up date', age: 'Age', years: 'years', hn: 'HN',
    overview: 'Overview',
    numbers: 'Key numbers',
    priorities: 'What to focus on, in order',
    why: 'Why it matters',
    plan: 'Your plan',
    next: 'Next appointments & tests',
    doctor: 'Your doctor',
    status: { good: 'Good', watch: 'Watch', act: 'Act on' },
    disclaimer: 'This summary supports your doctor’s advice. Contact the clinic if you feel unwell.',
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
export function buildSummaryFromData({ findings, problems, plan }, lang) {
  const t = T[lang]
  const top = [...problems].sort(prioritySort)
  const abnormal = findings.filter(isAbnormal).slice(0, 4)
  const byDomain = {}
  plan.forEach((p) => { (byDomain[p.domain] ||= []).push(p.action + (p.target ? ` (${p.target})` : '')) })
  return {
    headline: top.length
      ? (lang === 'th'
        ? `ผลตรวจครั้งนี้มี ${top.length} เรื่องหลักที่ควรดูแล โดยเริ่มจาก “${top[0].title}”`
        : `This check-up shows ${top.length} main areas to work on, starting with “${top[0].title}”.`)
      : t.overview,
    key_numbers: abnormal.map((f) => ({
      label: f.test_name,
      value: [f.value_text || f.value_num, f.unit].filter(Boolean).join(' '),
      status: f.flag === 'borderline' ? 'watch' : 'act',
    })),
    priorities: top.slice(0, 4).map((p) => ({ title: p.title, why: p.detail || '', level: p.priority })),
    plan: Object.entries(byDomain).filter(([d]) => d !== 'follow_up_test')
      .map(([domain, actions]) => ({ domain, actions: actions.slice(0, 3) })),
    next_steps: plan.filter((p) => p.domain === 'follow_up_test' || p.domain === 'referral')
      .map((p) => ({ what: p.action, when: p.timeframe || '' })),
  }
}

export const prioritySort = (a, b) =>
  ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority) ||
  (a.sort_order ?? 0) - (b.sort_order ?? 0)
