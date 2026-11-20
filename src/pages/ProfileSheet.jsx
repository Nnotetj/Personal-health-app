import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, aiAssist } from '../lib/supabase'
import { ageFrom, fmtDate } from '../lib/constants'
import {
  DOC_LANGS, LABELS, ROW_KEY, buildFollowup, buildSheetFromData, followPeriods, groupFollowup, levelLabel, normalizeSheet, planTypes, sheetProfileForAI,
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
      const [{ data: patient }, { data: sums }, { data: sections }] = await Promise.all([
        supabase.from('patients').select('*').eq('id', visit.patient_id).single(),
        supabase.from('patient_summaries').select('*').eq('visit_id', visitId).in('language', Object.values(ROW_KEY)),
        supabase.from('visit_sections').select('category, content').eq('visit_id', visitId),
      ])
      const d = { visit, patient, sections: sections || [] }
      const rows = {}, sh = {}, ai = {}
      for (const l of Object.keys(ROW_KEY)) {
        const row = (sums || []).find((r) => r.language === ROW_KEY[l])
        if (row) { rows[l] = row; sh[l] = normalizeSheet(row.content); ai[l] = !!row.ai_generated }
      }
      setData(d); setSaved(rows); setSheets(sh); setAiUsed(ai)
      setLang(['bi', 'en', 'th'].includes(patient?.doc_lang) ? patient.doc_lang : 'bi')
    })()
  }, [visitId])

  // ขอบกระดาษ A4 เฉพาะหน้านี้ (ไม่ใช้ named page เพราะบังคับขึ้นหน้าใหม่และทำให้เกิดหน้าว่างท้ายเอกสาร)
  useEffect(() => {
    const st = document.createElement('style')
    st.textContent = '@page { size: A4; margin: 14mm 15mm; }'
    document.head.appendChild(st)
    return () => st.remove()
  }, [])

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
      // กันตารางนัดว่าง: ถ้า AI ไม่ส่งรายการนัดมา ให้สร้างจากแผนที่ AI เขียนให้
      if (!out.followup.length) out.followup = buildFollowup(out.problems, out.plan, lang)
      out.header = sheet?.header || {}
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
  // ชื่อสั้นของปัญหา (ใช้ในตารางนัด) ถ้าไม่ได้ตั้ง ใช้ชื่อเต็ม
  const shortOf = (p) => (p.short || '').trim() || titleOf(p)
  // ปัญหาที่เกี่ยวข้อง: แสดงชื่อปัญหาเลย (ไม่ใช่เลขข้อ)
  // ถ้าแพทย์พิมพ์เอง (related_text) ใช้ข้อความนั้น ไม่เช่นนั้นดึงชื่อสั้นจากเลขข้อ
  const relatedTitles = (f) => (typeof f.related_text === 'string'
    ? f.related_text.split('\n').map((x) => x.trim()).filter(Boolean)
    : f.problems.map((n) => sheet.problems[n - 1]).filter(Boolean).map(shortOf))

  // ข้อความที่แก้ไขได้: โหมดดู = ข้อความ, โหมดแก้ = ช่องกรอก
  const E = ({ path, value, multi, placeholder, label }) => edit
    ? (multi
      ? <textarea className="ps-in" rows={2} aria-label={label || placeholder} defaultValue={value} placeholder={placeholder} onBlur={(e) => upd(path, e.target.value)} />
      : <input className="ps-in" aria-label={label || placeholder} defaultValue={value} placeholder={placeholder} onBlur={(e) => upd(path, e.target.value)} />)
    : <>{value}</>

  // ช่องข้อมูลทั่วไป: ถ้าแพทย์แก้ไว้ใช้ค่าที่แก้ ไม่เช่นนั้นใช้ค่าจากระบบ (เช่น แก้ชื่อแพทย์เป็นอังกฤษในฉบับ English)
  const H1 = ({ k, def, label }) => {
    const v = typeof sheet.header?.[k] === 'string' ? sheet.header[k] : def
    return edit
      ? <input className="ps-in" aria-label={label} defaultValue={v} onBlur={(e) => setSheet((s) => ({ ...s, header: { ...(s.header || {}), [k]: e.target.value } }))} />
      : <>{v}</>
  }

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
  const Del = ({ onClick, label }) => edit ? <button type="button" className="btn-quiet danger no-print ps-del" aria-label={label} onClick={onClick}>ลบ</button> : null
  const H = ({ pair, as: Tag = 'h2', className = 'ps-h' }) => <Tag className={className}>{pair[0]}{pair[1] && <> <small lang={lang === 'bi' ? 'en' : undefined}>{pair[1]}</small></>}</Tag>

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
                  ? <select className="ps-in" aria-label={L.planCols[0]} value={it.type} onChange={(e) => upd(['plan', gi, 'items', ii, 'type'], e.target.value)}>
                    {!types.includes(it.type) && <option value={it.type}>{it.type}</option>}
                    {types.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  : it.type}</td>
                <td><E path={['plan', gi, 'items', ii, 'action']} value={it.action} multi label={L.planCols[1]} /></td>
                <td><E path={['plan', gi, 'items', ii, 'target']} value={it.target} multi label={L.planCols[2]} /></td>
                <td><E path={['plan', gi, 'items', ii, 'follow_up']} value={it.follow_up} multi label={L.planCols[3]} /><Del label={`ลบแผนแถวที่ ${ii + 1}`} onClick={() => removePlanItem(gi, ii)} /></td>
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
        <div className="seg" role="group" aria-label="ภาษาของเอกสาร">
          {DOC_LANGS.map((d) => (
            <button key={d.key} type="button" aria-pressed={lang === d.key} className={lang === d.key ? 'on' : ''} onClick={() => switchLang(d.key)}>
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
        {msg && <span role="status" className={`alert inline ${msg.type}`}>{msg.text}</span>}
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
          <div><span>{L.name}</span><strong><H1 label={L.name} k="name" def={`${patient.first_name} ${patient.last_name}`} /></strong></div>
          <div><span>{L.hn}</span><strong><H1 label={L.hn} k="hn" def={patient.hn || '-'} /></strong></div>
          <div><span>{L.ageSex}</span><strong><H1 label={L.ageSex} k="age_sex" def={`${age !== '' ? `${age} ${L.ageUnit}` : '-'}${sexLabel ? ` / ${sexLabel}` : ''}`} /></strong></div>
          <div><span>{L.date}</span><strong><H1 label={L.date} k="date" def={fmtDate(visit.visit_date, L.dateLang)} /></strong></div>
          <div><span>{L.doctor}</span><strong><H1 label={L.doctor} k="doctor" def={visit.author?.full_name || '-'} /></strong></div>
          <div><span>{L.allergy}</span><strong><E path={['allergy']} value={sheet.allergy} label={L.allergy} /></strong></div>
        </div>

        {(sheet.family_history || edit) && (
          <p className="ps-line"><strong>{L.family}</strong> <E path={['family_history']} value={sheet.family_history} multi label={L.family} /></p>
        )}

        {(sheet.medications.length > 0 || edit) && (
          <>
            <h3 className="ps-h3">{L.meds}</h3>
            <table className="ps-table ps-meds">
              <thead><tr>{L.medCols.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
              <tbody>
                {sheet.medications.map((m, i) => (
                  <tr key={i}>
                    <td><E path={['medications', i, 'name']} value={m.name} label={L.medCols[0]} /></td>
                    <td><E path={['medications', i, 'use']} value={m.use} multi label={L.medCols[1]} /></td>
                    <td><E path={['medications', i, 'status']} value={m.status} label={L.medCols[2]} /><Del label={`ลบ ${m.name || `ยาแถวที่ ${i + 1}`}`} onClick={() => rm('medications', i)} /></td>
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
                    ? <strong className="ps-en"><E path={['problems', i, 'title_th']} value={titleOf(p)} multi label={`${L.probCols[1]} ${i + 1}`} /></strong>
                    : <strong className="ps-en" lang={lang === 'bi' ? 'en' : undefined}><E path={['problems', i, 'title_en']} value={p.title_en} multi label={`${L.probCols[1]} ${i + 1}`} /></strong>}
                  {lang === 'bi' && (p.title_th || edit) && <div><E path={['problems', i, 'title_th']} value={p.title_th} multi placeholder="ชื่อปัญหาภาษาไทย" /></div>}
                  {edit && <div><input className="ps-in" aria-label={`ชื่อสั้นของปัญหา ${i + 1}`} defaultValue={p.short || ''} placeholder="ชื่อสั้น (ใช้ในตารางนัด)" onBlur={(e) => upd(['problems', i, 'short'], e.target.value)} /></div>}
                </td>
                <td>{edit
                  ? <select className="ps-in" aria-label={`${L.probCols[2]} ${i + 1}`} value={p.level} onChange={(e) => upd(['problems', i, 'level'], e.target.value)}>
                    {['high', 'medium', 'low'].map((l) => <option key={l} value={l}>{levelLabel(l, lang)}</option>)}
                  </select>
                  : <span className={`ps-badge lv-${p.level}`}>{levelLabel(p.level, lang)}</span>}</td>
                <td><E path={['problems', i, 'evidence']} value={p.evidence} multi label={`${L.probCols[3]} ${i + 1}`} /><Del label={`ลบปัญหาที่ ${i + 1}`} onClick={() => removeProblem(i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {edit && <button className="btn-add no-print" onClick={() => setSheet((s) => ({ ...s, problems: [...s.problems, { title_en: '', title_th: '', short: '', level: 'medium', evidence: '' }] }))}>เพิ่มปัญหา</button>}

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
        {edit ? (
          <>
            <p className="muted small no-print">แต่ละแถว = 1 รายการ ช่วงเวลาเลือกจากรายการหรือพิมพ์เองก็ได้ รายการที่ช่วงเวลาเหมือนกันจะรวมเป็นกลุ่มเดียวในใบพิมพ์</p>
            <datalist id="follow-periods">{followPeriods(lang).map((x) => <option key={x} value={x} />)}</datalist>
            <table className="ps-table ps-follow">
              <thead><tr>{L.followCols.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
              <tbody>
                {sheet.followup.map((f, i) => (
                  <tr key={i}>
                    <td><input className="ps-in" aria-label={`${L.followCols[0]} แถวที่ ${i + 1}`} list="follow-periods" defaultValue={f.when} placeholder="เลือกหรือพิมพ์" onBlur={(e) => upd(['followup', i, 'when'], e.target.value)} /></td>
                    <td><E path={['followup', i, 'item']} value={f.item} multi label={`${L.followCols[1]} แถวที่ ${i + 1}`} /></td>
                    <td>
                      <textarea className="ps-in" rows={2} aria-label={`${L.followCols[2]} แถวที่ ${i + 1}`} defaultValue={relatedTitles(f).join('\n')} placeholder="ปัญหาที่เกี่ยวข้อง (1 บรรทัดต่อ 1 เรื่อง เว้นว่าง = ทั่วไป)"
                        onBlur={(e) => upd(['followup', i, 'related_text'], e.target.value)} />
                      <Del label={`ลบนัดแถวที่ ${i + 1}`} onClick={() => rm('followup', i)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <table className="ps-table ps-follow">
            <thead><tr>{L.followCols.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
            <tbody>
              {groupFollowup(sheet.followup).filter((g) => g.rows.some((r) => (r.item || '').trim())).map((g) => {
                const related = [...new Set(g.rows.flatMap(relatedTitles))]
                return (
                  <tr key={g.when}>
                    <td><strong>{g.when}</strong></td>
                    <td><ul className="ps-bullets">{g.rows.filter((r) => (r.item || '').trim()).map((r) => <li key={r.index}>{r.item}</li>)}</ul></td>
                    <td>{related.length ? related.join(', ') : L.generalRef}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {edit && (
          <div className="no-print">
            <button className="btn-add" onClick={() => setSheet((s) => ({ ...s, followup: [...s.followup, { when: '', item: '', problems: [] }] }))}>เพิ่มรายการนัด</button>
            <button className="btn-add" onClick={() => setSheet((s) => ({ ...s, followup: buildFollowup(s.problems, s.plan, lang) }))}>สร้างตารางนัดใหม่จากแผนด้านบน</button>
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
