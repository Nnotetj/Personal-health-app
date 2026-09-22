import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, aiAssist } from '../lib/supabase'
import { CATEGORIES, CAT, DOMAINS, FLAGS, PRIORITIES, ageFrom, uid } from '../lib/constants'
import { loadCatalog, normalizeFinding, computeFlag, unitMismatch } from '../lib/catalog'

const emptyFinding = (category) => ({ _k: uid(), _manual: true, category, subcategory: '', test_code: '', test_name: '', value_text: '', value_num: '', unit: '', ref_range: '', flag: 'normal', interpretation: '' })
const emptyProblem = () => ({ id: uid(), title: '', detail: '', priority: 'medium', category: '', status: 'active' })
const emptyPlan = () => ({ _k: uid(), problem_id: '', domain: 'nutrition', action: '', target: '', timeframe: '' })

const PLACEHOLDER = `ตัวอย่าง:
CBC: Hb 11.8 (low), MCV 76
FBG 108, HbA1c 5.9, fasting insulin 14 (HOMA-IR 3.8)
LDL 172, TG 190, HDL 38, ApoB 125
Vit D 18, ferritin 22, B12 310
TSH 3.9, free T4 normal
APOE e3/e4, MTHFR C677T heterozygous
Epigenetic age 46 (chronological 41)
Gut microbiome: low diversity, low Akkermansia
InBody: BF 31%, SMM 24 kg, visceral fat level 11
VO2 max 29 ml/kg/min (poor for age)
US upper abdomen: fatty liver grade 1
CAC score 0`

export default function VisitEditor() {
  const { id: patientIdParam, visitId } = useParams()
  const nav = useNavigate()
  const [patient, setPatient] = useState(null)
  const [visit, setVisit] = useState({ visit_date: new Date().toISOString().slice(0, 10), package_name: 'Full wellness package', raw_note: '', doctor_note: '', status: 'draft' })
  const [findings, setFindings] = useState([])
  const [problems, setProblems] = useState([])
  const [plan, setPlan] = useState([])
  const [aiDraft, setAiDraft] = useState(null)
  const [tab, setTab] = useState('conventional')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [catalog, setCatalog] = useState(null)

  useEffect(() => { loadCatalog().then(setCatalog) }, [])

  useEffect(() => {
    (async () => {
      let pid = patientIdParam
      if (visitId) {
        const [{ data: v }, { data: f }, { data: pr }, { data: pl }] = await Promise.all([
          supabase.from('visits').select('*').eq('id', visitId).single(),
          supabase.from('findings').select('*').eq('visit_id', visitId).order('sort_order'),
          supabase.from('problems').select('*').eq('visit_id', visitId).order('sort_order'),
          supabase.from('plan_items').select('*').eq('visit_id', visitId).order('sort_order'),
        ])
        if (!v) { setErr('ไม่พบผลตรวจนี้'); return }
        pid = v.patient_id
        setVisit(v); setAiDraft(v.ai_draft)
        setFindings((f || []).map((x) => ({ ...x, _k: x.id, value_num: x.value_num ?? '', test_code: x.test_code || '' })))
        setProblems((pr || []).map((x) => ({ ...x, category: x.category || '' })))
        setPlan((pl || []).map((x) => ({ ...x, _k: x.id, problem_id: x.problem_id || '' })))
      }
      const { data: p } = await supabase.from('patients').select('*').eq('id', pid).single()
      setPatient(p)
    })()
  }, [patientIdParam, visitId])

  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const touch = (fn) => (...a) => { setDirty(true); fn(...a) }
  const setV = touch((k, val) => setVisit((v) => ({ ...v, [k]: val })))
  const updFinding = touch((k, field, val) => setFindings((rows) => rows.map((r) => (r._k === k ? { ...r, [field]: val } : r))))
  const updProblem = touch((id, field, val) => setProblems((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: val } : r))))
  const updPlan = touch((k, field, val) => setPlan((rows) => rows.map((r) => (r._k === k ? { ...r, [field]: val } : r))))
  const sex = patient?.sex
  // on blur of name/value: map to catalog, and for manually typed rows auto-set flag
  const normalizeRow = (k) => setFindings((rows) => rows.map((r) => {
    if (r._k !== k) return r
    // keep the tab the doctor is typing in; AI-imported rows take the catalog category
    const n = { ...normalizeFinding(catalog, { ...r, test_code: '' }, sex), category: r.category }
    const entry = catalog?.byCode.get(n.test_code)
    const suggested = computeFlag(entry, n.value_num, sex, n.unit)
    return r._manual && suggested ? { ...n, flag: suggested } : n
  }))
  const moveProblem = touch((i, d) => setProblems((rows) => {
    const j = i + d
    if (j < 0 || j >= rows.length) return rows
    const c = [...rows];[c[i], c[j]] = [c[j], c[i]]
    return c
  }))

  async function runAI() {
    if (!visit.raw_note.trim()) { setErr('พิมพ์สรุปผลตรวจก่อน แล้วค่อยให้ AI ร่าง'); return }
    setErr(null); setBusy('ai')
    try {
      const ctx = patient ? [patient.sex && `sex ${patient.sex}`, patient.dob && `age ${ageFrom(patient.dob, visit.visit_date)}`, patient.background && `background: ${patient.background}`].filter(Boolean).join(', ') : ''
      const out = await aiAssist({ mode: 'extract', raw_note: visit.raw_note, patient_context: ctx, catalog_names: (catalog?.rows || []).map((r) => r.name) })
      const newProblems = (out.problems || []).map((p) => ({ ...emptyProblem(), ...p, category: p.category || '' }))
      const newFindings = (out.findings || []).map((f) => normalizeFinding(catalog, { ...emptyFinding(f.category), ...f, _manual: false, value_num: f.value_num ?? '', _k: uid() }, patient?.sex))
      const newPlan = (out.plan || []).map((p) => ({ ...emptyPlan(), ...p, problem_id: newProblems[p.problem_index]?.id || '', _k: uid() }))
      const hasData = findings.length || problems.length || plan.length
      const replace = !hasData || window.confirm('ฟอร์มมีข้อมูลอยู่แล้ว\nตกลง = แทนที่ด้วยร่างจาก AI\nยกเลิก = เพิ่มต่อท้ายข้อมูลเดิม')
      setFindings((r) => (replace ? newFindings : [...r, ...newFindings]))
      setProblems((r) => (replace ? newProblems : [...r, ...newProblems]))
      setPlan((r) => (replace ? newPlan : [...r, ...newPlan]))
      setAiDraft(out); setDirty(true)
      const firstCat = CATEGORIES.find((c) => newFindings.some((f) => f.category === c.key))
      if (firstCat) setTab(firstCat.key)
    } catch (e) {
      setErr(`AI ร่างไม่สำเร็จ: ${e.message}`)
    } finally { setBusy(null) }
  }

  async function save(status) {
    setErr(null); setBusy('save')
    const clean = (s) => (s === '' ? null : s)
    const { data, error } = await supabase.rpc('save_visit', {
      p_visit: { id: visitId || null, patient_id: patient.id, visit_date: visit.visit_date, package_name: visit.package_name,
        raw_note: visit.raw_note, doctor_note: visit.doctor_note, status, ai_draft: aiDraft },
      p_findings: findings.map((f, i) => ({ category: f.category, subcategory: clean(f.subcategory), test_code: clean(f.test_code), test_name: f.test_name,
        value_text: clean(f.value_text), value_num: f.value_num === '' || isNaN(Number(f.value_num)) ? null : Number(f.value_num),
        unit: clean(f.unit), ref_range: clean(f.ref_range), flag: f.flag, interpretation: clean(f.interpretation), sort_order: i })),
      p_problems: problems.map((p, i) => ({ id: p.id, title: p.title, detail: clean(p.detail), priority: p.priority,
        category: clean(p.category), status: p.status, sort_order: i })),
      p_plan: plan.map((p, i) => ({ problem_id: clean(p.problem_id), domain: p.domain, action: p.action,
        target: clean(p.target), timeframe: clean(p.timeframe), sort_order: i })),
    })
    setBusy(null)
    if (error) { setErr(error.message); return }
    setDirty(false)
    nav(`/patients/${patient.id}`)
  }

  if (!patient) return <div className="page muted">{err || 'กำลังโหลด…'}</div>

  const tabRows = findings.filter((f) => f.category === tab)
  const cat = CAT[tab]

  return (
    <div className="page editor">
      <Link to={`/patients/${patient.id}`} className="back">{patient.first_name} {patient.last_name}</Link>
      <div className="page-head">
        <h1>{visitId ? 'แก้ไขผลตรวจ' : 'บันทึกผลตรวจใหม่'}</h1>
        <div className="actions">
          <button className="btn-quiet" disabled={!!busy} onClick={() => save('draft')}>บันทึกร่าง</button>
          <button className="btn" disabled={!!busy} onClick={() => save('final')}>{busy === 'save' ? 'กำลังบันทึก…' : 'บันทึกและยืนยัน'}</button>
        </div>
      </div>
      {err && <p className="alert error">{err}</p>}

      <div className="editor-grid">
        {/* Step 1: free text */}
        <section className="panel note-panel">
          <h2><span className="step">1</span>สรุป pertinent findings</h2>
          <div className="form-grid">
            <label>วันที่ตรวจ<input type="date" value={visit.visit_date} onChange={(e) => setV('visit_date', e.target.value)} /></label>
            <label>แพ็กเกจ<input value={visit.package_name || ''} onChange={(e) => setV('package_name', e.target.value)} /></label>
          </div>
          <textarea className="note" rows={16} placeholder={PLACEHOLDER} value={visit.raw_note || ''} onChange={(e) => setV('raw_note', e.target.value)} />
          <p className="muted small">ไม่ต้องใส่ชื่อหรือ HN ในโน้ต ระบบจะส่งเพียงเพศ อายุ และประวัติพื้นฐานไปให้ AI</p>
          <button className="btn" onClick={runAI} disabled={!!busy}>{busy === 'ai' ? 'AI กำลังจัดหมวด…' : 'ให้ AI ร่างและจัดหมวด'}</button>
          <label className="mt">บันทึกแพทย์ (เห็นเฉพาะแพทย์)
            <textarea rows={4} value={visit.doctor_note || ''} onChange={(e) => setV('doctor_note', e.target.value)} placeholder="Clinical reasoning, differential, สิ่งที่ต้องติดตาม" />
          </label>
        </section>

        {/* Step 2: structured */}
        <section className="panel">
          <h2><span className="step">2</span>ตรวจทานและแก้ไข</h2>

          <div className="cat-tabs" role="tablist">
            {CATEGORIES.map((c) => {
              const n = findings.filter((f) => f.category === c.key).length
              return (
                <button key={c.key} role="tab" aria-selected={tab === c.key} className={`cat-tab cat-${c.key} ${tab === c.key ? 'on' : ''}`} onClick={() => setTab(c.key)}>
                  {c.name}<span className="n">{n}</span>
                </button>
              )
            })}
          </div>

          <div className={`cat-body cat-${tab}`}>
            {tabRows.length === 0 && <p className="muted small">ยังไม่มีรายการใน {cat.name}</p>}
            {tabRows.map((f) => (
              <div key={f._k} className="f-row">
                <select value={f.subcategory || ''} onChange={(e) => updFinding(f._k, 'subcategory', e.target.value)} aria-label="หมวดย่อย">
                  <option value="">หมวดย่อย</option>
                  {cat.subs.map((s) => <option key={s}>{s}</option>)}
                  {f.subcategory && !cat.subs.includes(f.subcategory) && <option>{f.subcategory}</option>}
                </select>
                <input className="w-name" placeholder="ชื่อการตรวจ" list={`cat-${tab}`} value={f.test_name} onChange={(e) => { updFinding(f._k, 'test_name', e.target.value); updFinding(f._k, 'test_code', '') }} onBlur={() => normalizeRow(f._k)} />
                <input className="w-val" placeholder="ค่าตัวเลข" inputMode="decimal" value={f.value_num} onChange={(e) => updFinding(f._k, 'value_num', e.target.value)} onBlur={() => normalizeRow(f._k)} />
                <input className="w-unit" placeholder="หน่วย" value={f.unit || ''} onChange={(e) => updFinding(f._k, 'unit', e.target.value)} />
                <input className="w-txt" placeholder="ผล (ข้อความ)" value={f.value_text || ''} onChange={(e) => updFinding(f._k, 'value_text', e.target.value)} />
                <input className="w-ref" placeholder="ค่าอ้างอิง" value={f.ref_range || ''} onChange={(e) => updFinding(f._k, 'ref_range', e.target.value)} />
                <select className={`w-flag flag-${f.flag}`} value={f.flag} onChange={(e) => { updFinding(f._k, 'flag', e.target.value); updFinding(f._k, '_manual', false) }} aria-label="สถานะ">
                  {Object.entries(FLAGS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input className="w-interp" placeholder="การแปลผล" value={f.interpretation || ''} onChange={(e) => updFinding(f._k, 'interpretation', e.target.value)} />
                <button className="btn-quiet danger" onClick={touch(() => setFindings((r) => r.filter((x) => x._k !== f._k)))} aria-label="ลบรายการ">ลบ</button>
                <CatalogHint f={f} catalog={catalog} sex={sex} onApply={(flag) => { updFinding(f._k, 'flag', flag); updFinding(f._k, '_manual', false) }} />
              </div>
            ))}
            <datalist id={`cat-${tab}`}>
              {(catalog?.rows || []).filter((r) => r.category === tab).map((r) => <option key={r.code} value={r.name}>{r.subcategory}</option>)}
            </datalist>
            <button className="btn-add" onClick={touch(() => setFindings((r) => [...r, emptyFinding(tab)]))}>เพิ่มรายการใน {cat.name}</button>
          </div>

          <h3 className="sub">ปัญหาเรียงตามความสำคัญ</h3>
          {problems.map((p, i) => (
            <div key={p.id} className={`p-row prio-${p.priority}`}>
              <div className="order">
                <button className="btn-quiet" onClick={() => moveProblem(i, -1)} aria-label="เลื่อนขึ้น" disabled={i === 0}>▲</button>
                <span>{i + 1}</span>
                <button className="btn-quiet" onClick={() => moveProblem(i, 1)} aria-label="เลื่อนลง" disabled={i === problems.length - 1}>▼</button>
              </div>
              <div className="p-fields">
                <input placeholder="ชื่อปัญหา เช่น Insulin resistance" value={p.title} onChange={(e) => updProblem(p.id, 'title', e.target.value)} />
                <input placeholder="รายละเอียด / เหตุผล" value={p.detail || ''} onChange={(e) => updProblem(p.id, 'detail', e.target.value)} />
                <div className="inline">
                  <select value={p.priority} onChange={(e) => updProblem(p.id, 'priority', e.target.value)} aria-label="ความสำคัญ">
                    {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <select value={p.category} onChange={(e) => updProblem(p.id, 'category', e.target.value)} aria-label="หมวด">
                    <option value="">หลายหมวด</option>
                    {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </select>
                  <select value={p.status} onChange={(e) => updProblem(p.id, 'status', e.target.value)} aria-label="สถานะปัญหา">
                    <option value="active">Active</option><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option>
                  </select>
                  <button className="btn-quiet danger" onClick={touch(() => { setProblems((r) => r.filter((x) => x.id !== p.id)); setPlan((r) => r.map((x) => (x.problem_id === p.id ? { ...x, problem_id: '' } : x))) })}>ลบ</button>
                </div>
              </div>
            </div>
          ))}
          <button className="btn-add" onClick={touch(() => setProblems((r) => [...r, emptyProblem()]))}>เพิ่มปัญหา</button>

          <h3 className="sub">Plan of management</h3>
          {plan.map((x) => (
            <div key={x._k} className="pl-row">
              <select value={x.problem_id} onChange={(e) => updPlan(x._k, 'problem_id', e.target.value)} aria-label="สำหรับปัญหา">
                <option value="">แผนทั่วไป</option>
                {problems.map((p, i) => <option key={p.id} value={p.id}>{i + 1}. {p.title || 'ยังไม่ตั้งชื่อ'}</option>)}
              </select>
              <select value={x.domain} onChange={(e) => updPlan(x._k, 'domain', e.target.value)} aria-label="ด้าน">
                {Object.entries(DOMAINS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <input className="w-action" placeholder="สิ่งที่ต้องทำ" value={x.action} onChange={(e) => updPlan(x._k, 'action', e.target.value)} />
              <input placeholder="เป้าหมาย" value={x.target || ''} onChange={(e) => updPlan(x._k, 'target', e.target.value)} />
              <input placeholder="ระยะเวลา" value={x.timeframe || ''} onChange={(e) => updPlan(x._k, 'timeframe', e.target.value)} />
              <button className="btn-quiet danger" onClick={touch(() => setPlan((r) => r.filter((y) => y._k !== x._k)))}>ลบ</button>
            </div>
          ))}
          <button className="btn-add" onClick={touch(() => setPlan((r) => [...r, emptyPlan()]))}>เพิ่มแผน</button>
        </section>
      </div>
    </div>
  )
}

function CatalogHint({ f, catalog, sex, onApply }) {
  if (!catalog || !f.test_name) return null
  const entry = f.test_code ? catalog.byCode.get(f.test_code) : null
  if (!entry) return <p className="f-hint muted">ไม่อยู่ใน test catalog แนวโน้มจะจับคู่จากชื่อนี้ตรง ๆ</p>
  if (unitMismatch(entry, f.unit)) return <p className="f-hint warn">หน่วยต่างจากมาตรฐาน ({entry.unit}) ระบบจึงไม่เช็ก flag ให้</p>
  const suggested = computeFlag(entry, f.value_num, sex, f.unit)
  if (suggested && suggested !== f.flag) {
    return (
      <p className="f-hint warn">
        ตามค่าอ้างอิงใน catalog ควรเป็น <strong>{FLAGS[suggested]}</strong>
        <button type="button" className="link-btn" onClick={() => onApply(suggested)}>ใช้ค่านี้</button>
      </p>
    )
  }
  return null
}
