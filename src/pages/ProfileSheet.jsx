import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, aiAssist } from '../lib/supabase'
import { ageFrom, fmtDate, prioritySort } from '../lib/constants'
import { PLAN_TYPES, buildFollowup, buildSheetFromData, levelLabel, normalizeSheet, sheetProfileForAI } from '../lib/sheet'

const LANG_KEY = 'bi' // แถวใน patient_summaries ที่เก็บฉบับ ไทย+อังกฤษ

function setIn(obj, path, val) {
  const copy = Array.isArray(obj) ? [...obj] : { ...obj }
  const [k, ...rest] = path
  copy[k] = rest.length ? setIn(obj[k] ?? {}, rest, val) : val
  return copy
}

export default function ProfileSheet() {
  const { visitId } = useParams()
  const [data, setData] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [savedRow, setSavedRow] = useState(null)
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [aiUsed, setAiUsed] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: visit } = await supabase.from('visits')
        .select('*, author:profiles!visits_created_by_fkey(full_name, license_no)').eq('id', visitId).single()
      if (!visit) return
      const [{ data: patient }, { data: problems }, { data: plan }, { data: sums }, { data: sections }] = await Promise.all([
        supabase.from('patients').select('*').eq('id', visit.patient_id).single(),
        supabase.from('problems').select('*').eq('visit_id', visitId),
        supabase.from('plan_items').select('*').eq('visit_id', visitId).order('sort_order'),
        supabase.from('patient_summaries').select('*').eq('visit_id', visitId).eq('language', LANG_KEY),
        supabase.from('visit_sections').select('category, content').eq('visit_id', visitId),
      ])
      const d = { visit, patient, problems: (problems || []).sort(prioritySort), plan: plan || [], sections: sections || [] }
      const row = sums?.[0] || null
      setData(d); setSavedRow(row)
      setSheet(normalizeSheet(row?.content) || buildSheetFromData(d))
      setAiUsed(!!row?.ai_generated)
    })()
  }, [visitId])

  async function generateAI() {
    setBusy('ai'); setMsg(null)
    try {
      const age = ageFrom(data.patient.dob, data.visit.visit_date)
      const out = normalizeSheet(await aiAssist({ mode: 'sheet', profile: sheetProfileForAI(data, age) }))
      setSheet(out); setAiUsed(true); setEdit(true)
      setMsg({ type: 'ok', text: 'AI ร่างแล้ว ตรวจทานและกดบันทึกก่อนพิมพ์' })
    } catch (e) { setMsg({ type: 'error', text: `AI ไม่สำเร็จ: ${e.message}` }) } finally { setBusy(null) }
  }

  async function save() {
    setBusy('save'); setMsg(null)
    const { data: row, error } = await supabase.from('patient_summaries')
      .upsert({ visit_id: visitId, language: LANG_KEY, content: sheet, ai_generated: aiUsed }, { onConflict: 'visit_id,language' })
      .select().single()
    setBusy(null)
    if (error) {
      const enumErr = /invalid input value for enum/i.test(error.message)
      setMsg({ type: 'error', text: enumErr ? 'ยังไม่ได้รัน migration 005 ใน Supabase (ดู README)' : error.message })
    } else { setSavedRow(row); setEdit(false); setMsg({ type: 'ok', text: 'บันทึกแล้ว' }) }
  }

  if (!data || !sheet) return <div className="page muted">กำลังโหลด…</div>
  const { patient, visit } = data
  const upd = (path, val) => setSheet((s) => setIn(s, path, val))
  const sexTh = { M: 'ชาย', F: 'หญิง', other: 'อื่น ๆ' }[patient.sex] || ''
  const age = patient.dob ? ageFrom(patient.dob, visit.visit_date) : ''

  // ข้อความที่แก้ไขได้: โหมดดู = ข้อความ, โหมดแก้ = ช่องกรอก
  const E = ({ path, value, multi, placeholder }) => edit
    ? (multi
      ? <textarea className="ps-in" rows={2} defaultValue={value} placeholder={placeholder} onBlur={(e) => upd(path, e.target.value)} />
      : <input className="ps-in" defaultValue={value} placeholder={placeholder} onBlur={(e) => upd(path, e.target.value)} />)
    : <>{value}</>

  function removeProblem(i) {
    const n = i + 1
    setSheet((s) => ({
      ...s,
      problems: s.problems.filter((_, j) => j !== i),
      plan: s.plan.filter((g) => g.problem !== n).map((g) => (g.problem > n ? { ...g, problem: g.problem - 1 } : g)),
      followup: s.followup.map((f) => ({ ...f, problems: f.problems.filter((p) => p !== n).map((p) => (p > n ? p - 1 : p)) })),
    }))
  }
  const planGroup = (n) => sheet.plan.findIndex((g) => g.problem === n)
  function addPlanItem(n) {
    setSheet((s) => {
      const empty = { type: PLAN_TYPES[0], action: '', target: '', follow_up: '' }
      const idx = s.plan.findIndex((g) => g.problem === n)
      return idx < 0
        ? { ...s, plan: [...s.plan, { problem: n, items: [empty] }] }
        : setIn(s, ['plan', idx, 'items'], [...s.plan[idx].items, empty])
    })
  }
  const removePlanItem = (gi, ii) => setSheet((s) => setIn(s, ['plan', gi, 'items'], s.plan[gi].items.filter((_, j) => j !== ii)))
  const rm = (key, i) => setSheet((s) => ({ ...s, [key]: s[key].filter((_, j) => j !== i) }))

  const Th = ({ children }) => <th>{children}</th>
  const Del = ({ onClick }) => edit ? <button className="btn-quiet danger no-print ps-del" onClick={onClick}>ลบ</button> : null

  const PlanTable = ({ n }) => {
    const gi = planGroup(n)
    const items = gi >= 0 ? sheet.plan[gi].items : []
    if (!items.length && !edit) return null
    return (
      <>
        <table className="ps-table ps-plan">
          <thead><tr><Th>ประเภท</Th><Th>การดำเนินการ</Th><Th>เป้าหมาย</Th><Th>ติดตามผล</Th></tr></thead>
          <tbody>
            {items.map((it, ii) => (
              <tr key={ii}>
                <td>{edit
                  ? <select className="ps-in" value={PLAN_TYPES.includes(it.type) ? it.type : 'อื่น ๆ'} onChange={(e) => upd(['plan', gi, 'items', ii, 'type'], e.target.value)}>
                    {PLAN_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  : it.type}</td>
                <td><E path={['plan', gi, 'items', ii, 'action']} value={it.action} multi /></td>
                <td><E path={['plan', gi, 'items', ii, 'target']} value={it.target} multi /></td>
                <td><E path={['plan', gi, 'items', ii, 'follow_up']} value={it.follow_up} multi /><Del onClick={() => removePlanItem(gi, ii)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {edit && <button className="btn-add no-print" onClick={() => addPlanItem(n)}>เพิ่มแผน</button>}
      </>
    )
  }

  return (
    <div className="summary-page">
      <div className="summary-tools no-print">
        <Link to={`/patients/${patient.id}`} className="back">กลับไปโปรไฟล์</Link>
        <button className="btn-quiet" onClick={generateAI} disabled={!!busy}>{busy === 'ai' ? 'AI กำลังเขียน…' : 'ให้ AI เติมภาษาไทย'}</button>
        <button className="btn-quiet" onClick={() => { setSheet(buildSheetFromData(data)); setAiUsed(false) }} disabled={!!busy}>สร้างจากโปรไฟล์ตรง ๆ</button>
        <button className="btn-quiet" onClick={() => setEdit(!edit)}>{edit ? 'ดูตัวอย่าง' : 'แก้ไขข้อความ'}</button>
        <button className="btn-quiet" onClick={save} disabled={!!busy}>บันทึก</button>
        <button className="btn" onClick={() => { setEdit(false); setTimeout(() => window.print(), 80) }}>พิมพ์ / PDF</button>
        {msg && <span className={`alert inline ${msg.type}`}>{msg.text}</span>}
        {!savedRow && !msg && <span className="muted small">ยังไม่ได้บันทึกฉบับนี้</span>}
      </div>

      <article className="sheet ps">
        <header className="ps-head">
          <p className="ps-kicker">PERSONAL HEALTH PROFILE</p>
          <h1>แบบบันทึกข้อมูลสุขภาพส่วนบุคคล</h1>
          <p className="ps-sub">รายการปัญหาสุขภาพเรียงตามความสำคัญ และแผนการดูแลรักษา (Problem List and Plan of Management)</p>
        </header>

        <h2 className="ps-h">1. ข้อมูลทั่วไปและประวัติที่เกี่ยวข้อง <small>(General Information)</small></h2>
        <div className="ps-grid">
          <div><span>ชื่อ–นามสกุล</span><strong>{patient.first_name} {patient.last_name}</strong></div>
          <div><span>HN / รหัสประจำตัว</span><strong>{patient.hn || '-'}</strong></div>
          <div><span>อายุ / เพศ</span><strong>{age !== '' ? `${age} ปี` : '-'}{sexTh ? ` / ${sexTh}` : ''}</strong></div>
          <div><span>วันที่ประเมิน</span><strong>{fmtDate(visit.visit_date, 'th')}</strong></div>
          <div><span>แพทย์ผู้ดูแล</span><strong>{visit.author?.full_name || '-'}</strong></div>
          <div><span>ประวัติแพ้ยา</span><strong><E path={['allergy']} value={sheet.allergy} placeholder="ปฏิเสธ / ระบุ" /></strong></div>
        </div>

        {(sheet.family_history || edit) && (
          <p className="ps-line"><strong>ประวัติครอบครัว:</strong> <E path={['family_history']} value={sheet.family_history} multi /></p>
        )}

        {(sheet.medications.length > 0 || edit) && (
          <>
            <h3 className="ps-h3">ยาและอาหารเสริมปัจจุบัน</h3>
            <table className="ps-table ps-meds">
              <thead><tr><Th>ยา / อาหารเสริม</Th><Th>ขนาดและข้อบ่งใช้</Th><Th>สถานะ</Th></tr></thead>
              <tbody>
                {sheet.medications.map((m, i) => (
                  <tr key={i}>
                    <td><E path={['medications', i, 'name']} value={m.name} /></td>
                    <td><E path={['medications', i, 'use']} value={m.use} multi /></td>
                    <td><E path={['medications', i, 'status']} value={m.status} /><Del onClick={() => rm('medications', i)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {edit && <button className="btn-add no-print" onClick={() => setSheet((s) => ({ ...s, medications: [...s.medications, { name: '', use: '', status: '' }] }))}>เพิ่มยา</button>}
          </>
        )}

        <h2 className="ps-h">2. รายการปัญหาเรียงตามความสำคัญ <small>(Problem List)</small></h2>
        <table className="ps-table ps-problems">
          <thead><tr><Th>ลำดับ</Th><Th>ปัญหา</Th><Th>ระดับ</Th><Th>ข้อมูลสนับสนุน</Th></tr></thead>
          <tbody>
            {sheet.problems.map((p, i) => (
              <tr key={i}>
                <td><strong>{i + 1}</strong></td>
                <td>
                  <strong className="ps-en"><E path={['problems', i, 'title_en']} value={p.title_en} multi /></strong>
                  {(p.title_th || edit) && <div><E path={['problems', i, 'title_th']} value={p.title_th} multi placeholder="ชื่อปัญหาภาษาไทย" /></div>}
                </td>
                <td>{edit
                  ? <select className="ps-in" value={p.level} onChange={(e) => upd(['problems', i, 'level'], e.target.value)}>
                    {['high', 'medium', 'low'].map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
                  </select>
                  : <span className={`ps-badge lv-${p.level}`}>{levelLabel(p.level)}</span>}</td>
                <td><E path={['problems', i, 'evidence']} value={p.evidence} multi /><Del onClick={() => removeProblem(i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {edit && <button className="btn-add no-print" onClick={() => setSheet((s) => ({ ...s, problems: [...s.problems, { title_en: '', title_th: '', level: 'medium', evidence: '' }] }))}>เพิ่มปัญหา</button>}

        <h2 className="ps-h">3. แผนการดูแลรักษา <small>(Plan of Management)</small></h2>
        {sheet.problems.map((p, i) => {
          const gi = planGroup(i + 1)
          if (!edit && (gi < 0 || !sheet.plan[gi].items.length)) return null
          return (
            <section key={i} className="ps-plan-block">
              <h3 className="ps-h3 ps-plan-h">
                <span>{i + 1}. {p.title_en}</span>
                <span className={`ps-badge lv-${p.level}`}>{levelLabel(p.level)}</span>
              </h3>
              <PlanTable n={i + 1} />
            </section>
          )
        })}
        {(planGroup(0) >= 0 || edit) && (
          <section className="ps-plan-block">
            <h3 className="ps-h3">ทั่วไป <small>(General)</small></h3>
            <PlanTable n={0} />
          </section>
        )}

        <h2 className="ps-h">4. ตารางนัดติดตามรวม <small>(Follow-up Schedule)</small></h2>
        <table className="ps-table ps-follow">
          <thead><tr><Th>ช่วงเวลา</Th><Th>รายการ</Th><Th>ปัญหาที่เกี่ยวข้อง</Th></tr></thead>
          <tbody>
            {sheet.followup.map((f, i) => (
              <tr key={i}>
                <td><strong><E path={['followup', i, 'when']} value={f.when} /></strong></td>
                <td><E path={['followup', i, 'item']} value={f.item} multi /></td>
                <td>{edit
                  ? <input className="ps-in" defaultValue={f.problems.join(', ')} placeholder="เช่น 1, 3"
                    onBlur={(e) => upd(['followup', i, 'problems'], e.target.value.split(/[,\s]+/).map(Number).filter(Boolean))} />
                  : (f.problems.length ? `ข้อ ${f.problems.join(', ')}` : 'ทั่วไป')}
                  <Del onClick={() => rm('followup', i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {edit && (
          <div className="no-print">
            <button className="btn-add" onClick={() => setSheet((s) => ({ ...s, followup: [...s.followup, { when: '', item: '', problems: [] }] }))}>เพิ่มรายการนัด</button>
            <button className="btn-add" onClick={() => setSheet((s) => ({ ...s, followup: buildFollowup(s.problems, s.plan) }))}>สร้างตารางนัดใหม่จากแผนด้านบน</button>
          </div>
        )}

        <section className="ps-auth">
          <h2 className="ps-h">5. การรับรองข้อมูล <small>(Authorization)</small></h2>
          <div className="ps-sign">
            <div><span className="ps-line-sign" />แพทย์ผู้ประเมิน (ลายมือชื่อ / เลขที่ใบอนุญาต)</div>
            <div><span className="ps-line-sign" />วันที่</div>
          </div>
        </section>
      </article>
    </div>
  )
}
