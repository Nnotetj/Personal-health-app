import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, aiAssist } from '../lib/supabase'
import { ageFrom, fmtDate, prioritySort } from '../lib/constants'
import {
  DOC_LANGS, LABELS, ROW_KEY, buildFollowup, buildSheetFromData, levelLabel, normalizeSheet, planTypes, sheetProfileForAI,
} from '../lib/sheet'

function setIn(obj, path, val) {
  const copy = Array.isArray(obj) ? [...obj] : { ...obj }
  const [k, ...rest] = path
  copy[k] = rest.length ? setIn(obj[k] ?? {}, rest, val) : val
  return copy
}

export default function ProfileSheet() {
  const { visitId } = useParams()
  const [data, setData] = useState(null)
  const [lang, setLang] = useState('bi')
  const [sheets, setSheets] = useState({})      // { bi, en, th } ฉบับที่กำลังเปิดอยู่ (รวมที่ยังไม่บันทึก)
  const [saved, setSaved] = useState({})        // { bi, en, th } แถวที่บันทึกแล้ว
  const [aiUsed, setAiUsed] = useState({})
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    (async () => {
      const { data: visit } = await supabase.from('visits')
        .select('*, author:profiles!visits_created_by_fkey(full_name, license_no)').eq('id', visitId).single()
      if (!visit) return
      const [{ data: patient }, { data: problems }, { data: plan }, { data: sums }, { data: sections }] = await Promise.all([
        supabase.from('patients').select('*').eq('id', visit.patient_id).single(),
        supabase.from('problems').select('*').eq('visit_id', visitId),
        supabase.from('plan_items').select('*').eq('visit_id', visitId).order('sort_order'),
        supabase.from('patient_summaries').select('*').eq('visit_id', visitId).in('language', Object.values(ROW_KEY)),
        supabase.from('visit_sections').select('category, content').eq('visit_id', visitId),
      ])
      const d = { visit, patient, problems: (problems || []).sort(prioritySort), plan: plan || [], sections: sections || [] }
      const rows = {}, sh = {}, ai = {}
      for (const l of Object.keys(ROW_KEY)) {
        const row = (sums || []).find((r) => r.language === ROW_KEY[l])
        if (row) { rows[l] = row; sh[l] = normalizeSheet(row.content); ai[l] = !!row.ai_generated }
      }
      setData(d); setSaved(rows); setSheets(sh); setAiUsed(ai)
      setLang(['bi', 'en', 'th'].includes(patient?.doc_lang) ? patient.doc_lang : 'bi')
    })()
  }, [visitId])

  // ฉบับที่ยังไม่เคยบันทึกในภาษานี้ ให้เริ่มจากโปรไฟล์ตรง ๆ
  useEffect(() => {
    if (data && !sheets[lang]) setSheets((s) => ({ ...s, [lang]: buildSheetFromData(data, lang) }))
  }, [data, lang, sheets])

  const sheet = sheets[lang]
  const setSheet = (fn) => setSheets((all) => ({ ...all, [lang]: typeof fn === 'function' ? fn(all[lang]) : fn }))

  async function generateAI() {
    setBusy('ai'); setMsg(null)
    try {
      const age = ageFrom(data.patient.dob, data.visit.visit_date)
      const out = normalizeSheet(await aiAssist({ mode: 'sheet', language: lang, profile: sheetProfileForAI(data, age) }))
      setSheet(out); setAiUsed((a) => ({ ...a, [lang]: true })); setEdit(true)
      setMsg({ type: 'ok', text: 'AI ร่างแล้ว ตรวจทานและกดบันทึกก่อนพิมพ์' })
    } catch (e) { setMsg({ type: 'error', text: `AI ไม่สำเร็จ: ${e.message}` }) } finally { setBusy(null) }
  }

  async function save() {
    setBusy('save'); setMsg(null)
    const { data: row, error } = await supabase.from('patient_summaries')
      .upsert({ visit_id: visitId, language: ROW_KEY[lang], content: sheet, ai_generated: !!aiUsed[lang] }, { onConflict: 'visit_id,language' })
      .select().single()
    setBusy(null)
    if (error) {
      const enumErr = /invalid input value for enum/i.test(error.message)
      setMsg({ type: 'error', text: enumErr ? 'ยังไม่ได้รัน migration ใน Supabase (005 สำหรับ ไทย+English, 006 สำหรับ English / ไทย)' : error.message })
    } else { setSaved((s) => ({ ...s, [lang]: row })); setEdit(false); setMsg({ type: 'ok', text: 'บันทึกแล้ว' }) }
  }

  function switchLang(l) { setLang(l); setEdit(false); setMsg(null) }

  if (!data || !sheet) return <div className="page muted">กำลังโหลด…</div>
  const L = LABELS[lang]
  const { patient, visit } = data
  const upd = (path, val) => setSheet((s) => setIn(s, path, val))
  const sexLabel = L.sex[patient.sex] || ''
  const age = patient.dob ? ageFrom(patient.dob, visit.visit_date) : ''
  const types = planTypes(lang)
  const titleOf = (p) => (lang === 'th' ? (p.title_th || p.title_en) : p.title_en)

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
      const empty = { type: types[0], action: '', target: '', follow_up: '' }
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
  const H = ({ pair, as: Tag = 'h2', className = 'ps-h' }) => <Tag className={className}>{pair[0]}{pair[1] && <> <small>{pair[1]}</small></>}</Tag>

  const PlanTable = ({ n }) => {
    const gi = planGroup(n)
    const items = gi >= 0 ? sheet.plan[gi].items : []
    if (!items.length && !edit) return null
    return (
      <>
        <table className="ps-table ps-plan">
          <thead><tr>{L.planCols.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
          <tbody>
            {items.map((it, ii) => (
              <tr key={ii}>
                <td>{edit
                  ? <select className="ps-in" value={it.type} onChange={(e) => upd(['plan', gi, 'items', ii, 'type'], e.target.value)}>
                    {!types.includes(it.type) && <option value={it.type}>{it.type}</option>}
                    {types.map((t) => <option key={t}>{t}</option>)}
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
        <div className="seg" role="tablist" aria-label="ภาษาของเอกสาร">
          {DOC_LANGS.map((d) => (
            <button key={d.key} role="tab" aria-selected={lang === d.key} className={lang === d.key ? 'on' : ''} onClick={() => switchLang(d.key)}>
              {d.label}{saved[d.key] ? ' ✓' : ''}
            </button>
          ))}
        </div>
        <button className="btn-quiet" onClick={generateAI} disabled={!!busy}>
          {busy === 'ai' ? 'AI กำลังเขียน…' : lang === 'en' ? 'ให้ AI เขียนฉบับ English' : lang === 'th' ? 'ให้ AI เขียนฉบับไทย' : 'ให้ AI เติมภาษาไทย'}
        </button>
        <button className="btn-quiet" onClick={() => { setSheet(buildSheetFromData(data, lang)); setAiUsed((a) => ({ ...a, [lang]: false })) }} disabled={!!busy}>สร้างจากโปรไฟล์ตรง ๆ</button>
        <button className="btn-quiet" onClick={() => setEdit(!edit)}>{edit ? 'ดูตัวอย่าง' : 'แก้ไขข้อความ'}</button>
        <button className="btn-quiet" onClick={save} disabled={!!busy}>บันทึก</button>
        <button className="btn" onClick={() => { setEdit(false); setTimeout(() => window.print(), 80) }}>พิมพ์ / PDF</button>
        {msg && <span className={`alert inline ${msg.type}`}>{msg.text}</span>}
        {!saved[lang] && !msg && <span className="muted small">ฉบับนี้ยังไม่ได้บันทึก (✓ = บันทึกแล้ว)</span>}
      </div>

      <article className="sheet ps" lang={lang === 'en' ? 'en' : 'th'}>
        <header className="ps-head">
          <p className="ps-kicker">{L.kicker}</p>
          <h1>{L.title}</h1>
          <p className="ps-sub">{L.sub}</p>
        </header>

        <H pair={L.s1} />
        <div className="ps-grid">
          <div><span>{L.name}</span><strong>{patient.first_name} {patient.last_name}</strong></div>
          <div><span>{L.hn}</span><strong>{patient.hn || '-'}</strong></div>
          <div><span>{L.ageSex}</span><strong>{age !== '' ? `${age} ${L.ageUnit}` : '-'}{sexLabel ? ` / ${sexLabel}` : ''}</strong></div>
          <div><span>{L.date}</span><strong>{fmtDate(visit.visit_date, L.dateLang)}</strong></div>
          <div><span>{L.doctor}</span><strong>{visit.author?.full_name || '-'}</strong></div>
          <div><span>{L.allergy}</span><strong><E path={['allergy']} value={sheet.allergy} /></strong></div>
        </div>

        {(sheet.family_history || edit) && (
          <p className="ps-line"><strong>{L.family}</strong> <E path={['family_history']} value={sheet.family_history} multi /></p>
        )}

        {(sheet.medications.length > 0 || edit) && (
          <>
            <h3 className="ps-h3">{L.meds}</h3>
            <table className="ps-table ps-meds">
              <thead><tr>{L.medCols.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
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

        <H pair={L.s2} />
        <table className="ps-table ps-problems">
          <thead><tr>{L.probCols.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
          <tbody>
            {sheet.problems.map((p, i) => (
              <tr key={i}>
                <td><strong>{i + 1}</strong></td>
                <td>
                  {lang === 'th'
                    ? <strong className="ps-en"><E path={['problems', i, 'title_th']} value={titleOf(p)} multi /></strong>
                    : <strong className="ps-en"><E path={['problems', i, 'title_en']} value={p.title_en} multi /></strong>}
                  {lang === 'bi' && (p.title_th || edit) && <div><E path={['problems', i, 'title_th']} value={p.title_th} multi placeholder="ชื่อปัญหาภาษาไทย" /></div>}
                </td>
                <td>{edit
                  ? <select className="ps-in" value={p.level} onChange={(e) => upd(['problems', i, 'level'], e.target.value)}>
                    {['high', 'medium', 'low'].map((l) => <option key={l} value={l}>{levelLabel(l, lang)}</option>)}
                  </select>
                  : <span className={`ps-badge lv-${p.level}`}>{levelLabel(p.level, lang)}</span>}</td>
                <td><E path={['problems', i, 'evidence']} value={p.evidence} multi /><Del onClick={() => removeProblem(i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {edit && <button className="btn-add no-print" onClick={() => setSheet((s) => ({ ...s, problems: [...s.problems, { title_en: '', title_th: '', level: 'medium', evidence: '' }] }))}>เพิ่มปัญหา</button>}

        <H pair={L.s3} />
        {sheet.problems.map((p, i) => {
          const gi = planGroup(i + 1)
          if (!edit && (gi < 0 || !sheet.plan[gi].items.length)) return null
          return (
            <section key={i} className="ps-plan-block">
              <h3 className="ps-h3 ps-plan-h">
                <span>{i + 1}. {titleOf(p)}</span>
                <span className={`ps-badge lv-${p.level}`}>{levelLabel(p.level, lang)}</span>
              </h3>
              <PlanTable n={i + 1} />
            </section>
          )
        })}
        {(planGroup(0) >= 0 || edit) && (
          <section className="ps-plan-block">
            <H pair={L.general} as="h3" className="ps-h3" />
            <PlanTable n={0} />
          </section>
        )}

        <H pair={L.s4} />
        <table className="ps-table ps-follow">
          <thead><tr>{L.followCols.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
          <tbody>
            {sheet.followup.map((f, i) => (
              <tr key={i}>
                <td><strong><E path={['followup', i, 'when']} value={f.when} /></strong></td>
                <td><E path={['followup', i, 'item']} value={f.item} multi /></td>
                <td>{edit
                  ? <input className="ps-in" defaultValue={f.problems.join(', ')} placeholder="1, 3"
                    onBlur={(e) => upd(['followup', i, 'problems'], e.target.value.split(/[,\s]+/).map(Number).filter(Boolean))} />
                  : (f.problems.length ? `${L.item} ${f.problems.join(', ')}` : L.generalRef)}
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
          <H pair={L.s5} />
          <div className="ps-sign">
            <div><span className="ps-line-sign" />{L.signDoctor}</div>
            <div><span className="ps-line-sign" />{L.signDate}</div>
          </div>
        </section>
      </article>
    </div>
  )
}
