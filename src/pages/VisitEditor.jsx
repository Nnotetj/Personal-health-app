import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, aiAssist } from '../lib/supabase'
import { CATEGORIES, INTEGRATED, PROBLEM_LIST, PLAN_TEXT, FLAGS, ageFrom, planToText, problemsToText, uid } from '../lib/constants'

// กันค่าที่ฐานข้อมูลไม่รู้จัก (AI บางครั้งตั้งชื่อเอง)
const okFlag = (f) => (FLAGS[f] ? f : 'normal')
const okCategory = (c) => (CATEGORIES.some((x) => x.key === c) ? c : 'biomarker')
import { loadCatalog, normalizeFinding, computeFlag, unitMismatch } from '../lib/catalog'

const emptyValue = (category = 'biomarker') =>
  ({ _k: uid(), _manual: true, category, test_code: '', test_name: '', value_num: '', unit: '', ref_range: '', flag: 'normal' })
const SECTION_KEYS = [...CATEGORIES.map((c) => c.key), INTEGRATED.key, PROBLEM_LIST.key, PLAN_TEXT.key]
const emptySections = () => Object.fromEntries(SECTION_KEYS.map((k) => [k, '']))

const PLACEHOLDER = `ตัวอย่าง:
U/D = DLP, GERD | allergy: deny
current med = Rosuvastatin 10 mg, Nexium
smk 20 cigs/d, alc 2+ | FHx: dad = prostate CA
CONCERN: heart, bloating, low energy
BODY: BMI 26, visc fat 2+, BF 32%, lo LMI
Fit age 50.6 | lo grip, nl VO2 max
CVD: LDL 119, HDL 48, sdLDL 23 | CIMT 0.9, plaque, CAC 0, echo nl
Vit D 30, CRP 1.6, TMAO high
Thyroid: hi FT4, TSH 3, nodule 0.6 cm TR4
GI: fatty liver
Epigenetic: CA 49.8, bio age 43.3, pace 0.8
Genetic: hi risk pancreatic CA, carrier CFTR
OAT: TCA under-run, dysbiosis markers`

export default function VisitEditor() {
  const { id: patientIdParam, visitId } = useParams()
  const nav = useNavigate()
  const [patient, setPatient] = useState(null)
  const [visit, setVisit] = useState({ visit_date: new Date().toISOString().slice(0, 10), package_name: 'Full wellness package', raw_note: '', doctor_note: '', status: 'draft' })
  const [sections, setSections] = useState(emptySections())
  const [values, setValues] = useState([])
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
        const loaded = { ...emptySections(), ...Object.fromEntries((sec || []).map((s) => [s.category, s.content])) }
        // ข้อมูลเก่าที่เก็บเป็นตาราง: แปลงเป็นข้อความให้แก้ต่อได้ (บันทึกครั้งหน้าจะเก็บเป็นข้อความ)
        if (!loaded.problem_list && (pr || []).length) loaded.problem_list = problemsToText(pr)
        if (!loaded.plan_text && (pl || []).length) loaded.plan_text = planToText(pl, pr || [])
        setSections(loaded)
        setValues((f || []).map((x) => ({ ...x, _k: x.id, _manual: false, value_num: x.value_num ?? '', test_code: x.test_code || '' })))
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
      const newValues = (out.key_values || []).map((v) =>
        normalizeFinding(catalog, { ...emptyValue(okCategory(v.category)), ...v, category: okCategory(v.category), flag: okFlag(v.flag), _manual: false, value_num: v.value_num ?? '', _k: uid() }, sex))
      setSections({ ...emptySections(), ...(out.sections || {}) })
      setValues(newValues)
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
      p_sections: SECTION_KEYS.map((k) => ({ category: k, content: sections[k] || '' })),
      p_findings: values.map((f, i) => ({ category: okCategory(f.category), subcategory: clean(f.subcategory), test_code: clean(f.test_code),
        test_name: f.test_name, value_num: f.value_num === '' || isNaN(Number(f.value_num)) ? null : Number(f.value_num),
        unit: clean(f.unit), ref_range: clean(f.ref_range), flag: okFlag(f.flag), sort_order: i })),
      p_problems: [],   // ปัญหาและแผนเก็บเป็นข้อความใน p_sections แล้ว
      p_plan: [],
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
          <p className="muted small">AI เรียบเรียงเป็น 5 หมวดแบบ MECE พร้อม Integrated Profile แก้ไขได้เหมือนแก้เอกสาร</p>

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

          <section className="sec-edit cat-integrated">
            <header>
              <h3>{INTEGRATED.name}</h3>
              <span className="muted small">{INTEGRATED.hint}</span>
            </header>
            <textarea
              className="sec-text"
              rows={Math.min(Math.max((sections.integrated || '').split('\n').length + 1, 3), 10)}
              placeholder="ยังไม่มี Integrated Profile"
              value={sections.integrated || ''}
              onChange={(e) => setSection('integrated', e.target.value)}
            />
          </section>

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

          {[PROBLEM_LIST, PLAN_TEXT].map((box) => (
            <section key={box.key} className="text-box">
              <h3 className="sub">{box.name} <span className="muted small">{box.hint}</span></h3>
              <textarea
                className="sec-text"
                rows={Math.min(Math.max((sections[box.key] || '').split('\n').length + 1, 4), 16)}
                placeholder={`ยังไม่มี${box.name}`}
                value={sections[box.key] || ''}
                onChange={(e) => setSection(box.key, e.target.value)}
              />
            </section>
          ))}
        </section>
      </div>
    </div>
  )
}
