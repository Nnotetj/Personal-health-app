import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, aiAssist } from '../lib/supabase'
import { CATEGORIES, DOMAINS, FLAGS, PRIORITIES, ageFrom, uid } from '../lib/constants'
import { loadCatalog, normalizeFinding, computeFlag, unitMismatch } from '../lib/catalog'

const emptyValue = (category = 'conventional') =>
  ({ _k: uid(), _manual: true, category, test_code: '', test_name: '', value_num: '', unit: '', ref_range: '', flag: 'normal' })
const emptyProblem = () => ({ id: uid(), title: '', detail: '', priority: 'medium', category: '', status: 'active' })
const emptyPlan = () => ({ _k: uid(), problem_id: '', domain: 'nutrition', action: '', target: '', timeframe: '' })
const emptySections = () => Object.fromEntries(CATEGORIES.map((c) => [c.key, '']))

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
  const [sections, setSections] = useState(emptySections())
  const [values, setValues] = useState([])
  const [problems, setProblems] = useState([])
  const [plan, setPlan] = useState([])
  const [aiDraft, setAiDraft] = useState(null)
  const [showValues, setShowValues] = useState(false)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [catalog, setCatalog] = useState(null)

  useEffect(() => { loadCatalog().then(setCatalog) }, [])

  useEffect(() => {
    (async () => {
      let pid = patientIdParam
      if (visitId) {
        const [{ data: v }, { data: sec }, { data: f }, { data: pr }, { data: pl }] = await Promise.all([
          supabase.from('visits').select('*').eq('id', visitId).single(),
          supabase.from('visit_sections').select('*').eq('visit_id', visitId),
          supabase.from('findings').select('*').eq('visit_id', visitId).order('sort_order'),
          supabase.from('problems').select('*').eq('visit_id', visitId).order('sort_order'),
          supabase.from('plan_items').select('*').eq('visit_id', visitId).order('sort_order'),
        ])
        if (!v) { setErr('ไม่พบผลตรวจนี้'); return }
        pid = v.patient_id
        setVisit(v); setAiDraft(v.ai_draft)
        setSections({ ...emptySections(), ...Object.fromEntries((sec || []).map((s) => [s.category, s.content])) })
        setValues((f || []).map((x) => ({ ...x, _k: x.id, _manual: false, value_num: x.value_num ?? '', test_code: x.test_code || '' })))
        setProblems((pr || []).map((x) => ({ ...x, category: x.category || '' })))
        setPlan((pl || []).map((x) => ({ ...x, _k: x.id, problem_id: x.problem_id || '' })))
        if ((f || []).length) setShowValues(true)
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

  const sex = patient?.sex
  const touch = (fn) => (...a) => { setDirty(true); fn(...a) }
  const setV = touch((k, val) => setVisit((v) => ({ ...v, [k]: val })))
  const setSection = touch((key, text) => setSections((s) => ({ ...s, [key]: text })))
  const updValue = touch((k, field, val) => setValues((rows) => rows.map((r) => (r._k === k ? { ...r, [field]: val } : r))))
  const updProblem = touch((id, field, val) => setProblems((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: val } : r))))
  const updPlan = touch((k, field, val) => setPlan((rows) => rows.map((r) => (r._k === k ? { ...r, [field]: val } : r))))
  const moveProblem = touch((i, d) => setProblems((rows) => {
    const j = i + d
    if (j < 0 || j >= rows.length) return rows
    const c = [...rows];[c[i], c[j]] = [c[j], c[i]]
    return c
  }))
  const normalizeRow = (k) => setValues((rows) => rows.map((r) => {
    if (r._k !== k) return r
    const n = normalizeFinding(catalog, { ...r, test_code: '' }, sex)
    const entry = catalog?.byCode.get(n.test_code)
    const suggested = computeFlag(entry, n.value_num, sex, n.unit)
    return r._manual && suggested ? { ...n, flag: suggested } : n
  }))

  async function runAI() {
    if (!visit.raw_note.trim()) { setErr('พิมพ์สรุปผลตรวจก่อน แล้วค่อยให้ AI ร่าง'); return }
    setErr(null); setBusy('ai')
    try {
      const ctx = patient ? [patient.sex && `sex ${patient.sex}`, patient.dob && `age ${ageFrom(patient.dob, visit.visit_date)}`, patient.background && `background: ${patient.background}`].filter(Boolean).join(', ') : ''
      const out = await aiAssist({
        mode: 'extract', raw_note: visit.raw_note, patient_context: ctx,
        catalog_names: (catalog?.rows || []).map((r) => r.name),
      })
      const newProblems = (out.problems || []).map((p) => ({ ...emptyProblem(), ...p, category: p.category || '' }))
      const newPlan = (out.plan || []).map((p) => ({ ...emptyPlan(), ...p, problem_id: newProblems[p.problem_index]?.id || '', _k: uid() }))
      const newValues = (out.key_values || []).map((v) =>
        normalizeFinding(catalog, { ...emptyValue(v.category), ...v, _manual: false, value_num: v.value_num ?? '', _k: uid() }, sex))
      setSections({ ...emptySections(), ...(out.sections || {}) })
      setProblems(newProblems); setPlan(newPlan); setValues(newValues)
      setAiDraft(out); setDirty(true)
      if (newValues.length) setShowValues(true)
    } catch (e) {
      setErr(`AI ร่างไม่สำเร็จ: ${e.message}`)
    } finally { setBusy(null) }
  }

  async function save(status) {
    setErr(null); setBusy('save')
    const clean = (s) => (s === '' ? null : s)
    const { error } = await supabase.rpc('save_visit', {
      p_visit: { id: visitId || null, patient_id: patient.id, visit_date: visit.visit_date, package_name: visit.package_name,
        raw_note: visit.raw_note, doctor_note: visit.doctor_note, status, ai_draft: aiDraft },
      p_sections: CATEGORIES.map((c) => ({ category: c.key, content: sections[c.key] || '' })),
      p_findings: values.map((f, i) => ({ category: f.category, subcategory: clean(f.subcategory), test_code: clean(f.test_code),
        test_name: f.test_name, value_num: f.value_num === '' || isNaN(Number(f.value_num)) ? null : Number(f.value_num),
        unit: clean(f.unit), ref_range: clean(f.ref_range), flag: f.flag, sort_order: i })),
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
        {/* Step 1 */}
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

        {/* Step 2 */}
        <section className="panel">
          <h2><span className="step">2</span>ตรวจทานและแก้ไข</h2>
          <p className="muted small">AI เรียบเรียงเป็นข้อความ 4 หมวด แก้ไขได้เหมือนแก้เอกสาร</p>

          {CATEGORIES.map((c) => (
            <section key={c.key} className={`sec-edit cat-${c.key}`}>
              <header>
                <h3>{c.name}</h3>
                <span className="muted small">{c.hint}</span>
              </header>
              <textarea
                className="sec-text"
                rows={Math.min(Math.max((sections[c.key] || '').split('\n').length + 1, 3), 16)}
                placeholder={`ยังไม่มีข้อมูลใน ${c.name}`}
                value={sections[c.key] || ''}
                onChange={(e) => setSection(c.key, e.target.value)}
              />
            </section>
          ))}

          {/* key numeric values for trends */}
          <div className="values-block">
            <button className="btn-quiet toggle" onClick={() => setShowValues(!showValues)}>
              {showValues ? 'ซ่อน' : 'แสดง'}ค่าตัวเลขสำหรับกราฟแนวโน้ม ({values.length})
            </button>
            {showValues && (
              <>
                <p className="muted small">AI ดึงค่าสำคัญมาให้แล้ว ค่าเหล่านี้ใช้ทำกราฟเทียบกับครั้งก่อน ลบหรือเพิ่มได้ตามต้องการ</p>
                {values.map((f) => {
                  const entry = f.test_code ? catalog?.byCode.get(f.test_code) : null
                  const suggested = entry ? computeFlag(entry, f.value_num, sex, f.unit) : null
                  return (
                    <div key={f._k} className={`v-row cat-${f.category}`}>
                      <select value={f.category} onChange={(e) => updValue(f._k, 'category', e.target.value)} aria-label="หมวด">
                        {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                      </select>
                      <input className="w-name" placeholder="ชื่อการตรวจ" list="all-tests" value={f.test_name}
                        onChange={(e) => { updValue(f._k, 'test_name', e.target.value); updValue(f._k, 'test_code', '') }}
                        onBlur={() => normalizeRow(f._k)} />
                      <input className="w-val" placeholder="ค่า" inputMode="decimal" value={f.value_num}
                        onChange={(e) => updValue(f._k, 'value_num', e.target.value)} onBlur={() => normalizeRow(f._k)} />
                      <input className="w-unit" placeholder="หน่วย" value={f.unit || ''} onChange={(e) => updValue(f._k, 'unit', e.target.value)} />
                      <input className="w-ref" placeholder="ค่าอ้างอิง" value={f.ref_range || ''} onChange={(e) => updValue(f._k, 'ref_range', e.target.value)} />
                      <select className={`w-flag flag-${f.flag}`} value={f.flag}
                        onChange={(e) => { updValue(f._k, 'flag', e.target.value); updValue(f._k, '_manual', false) }} aria-label="สถานะ">
                        {Object.entries(FLAGS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      <button className="btn-quiet danger" onClick={touch(() => setValues((r) => r.filter((x) => x._k !== f._k)))}>ลบ</button>
                      {entry && unitMismatch(entry, f.unit)
                        ? <p className="f-hint warn">หน่วยต่างจากมาตรฐาน ({entry.unit}) ระบบจึงไม่เช็ก flag ให้</p>
                        : suggested && suggested !== f.flag
                          ? <p className="f-hint warn">ตามค่าอ้างอิงควรเป็น <strong>{FLAGS[suggested]}</strong>
                            <button type="button" className="link-btn" onClick={() => { updValue(f._k, 'flag', suggested); updValue(f._k, '_manual', false) }}>ใช้ค่านี้</button>
                          </p>
                          : null}
                    </div>
                  )
                })}
                <datalist id="all-tests">
                  {(catalog?.rows || []).map((r) => <option key={r.code} value={r.name}>{r.subcategory}</option>)}
                </datalist>
                <button className="btn-add" onClick={touch(() => setValues((r) => [...r, emptyValue()]))}>เพิ่มค่าตัวเลข</button>
              </>
            )}
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
