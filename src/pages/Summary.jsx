import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, aiAssist, CLINIC_NAME } from '../lib/supabase'
import { T, ageFrom, buildSummaryFromData, countWords, fmtDate, prioritySort, toProfileShape } from '../lib/constants'

export default function Summary() {
  const { visitId } = useParams()
  const [data, setData] = useState(null)
  const [lang, setLang] = useState('th')
  const [saved, setSaved] = useState({})
  const [content, setContent] = useState(null)
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [aiUsed, setAiUsed] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: visit } = await supabase.from('visits').select('*, author:profiles!visits_created_by_fkey(full_name, license_no)').eq('id', visitId).single()
      if (!visit) return
      const [{ data: patient }, { data: findings }, { data: problems }, { data: plan }, { data: sums }, { data: sections }] = await Promise.all([
        supabase.from('patients').select('*').eq('id', visit.patient_id).single(),
        supabase.from('findings').select('*').eq('visit_id', visitId).order('sort_order'),
        supabase.from('problems').select('*').eq('visit_id', visitId),
        supabase.from('plan_items').select('*').eq('visit_id', visitId).order('sort_order'),
        supabase.from('patient_summaries').select('*').eq('visit_id', visitId),
        supabase.from('visit_sections').select('category, content').eq('visit_id', visitId),
      ])
      setData({ visit, patient, findings: findings || [], problems: (problems || []).sort(prioritySort), plan: plan || [], sections: sections || [] })
      setSaved(Object.fromEntries((sums || []).map((s) => [s.language, s])))
    })()
  }, [visitId])

  useEffect(() => {
    if (!data) return
    setContent(toProfileShape(saved[lang]?.content, lang) || buildSummaryFromData(data, lang))
    setAiUsed(!!saved[lang]?.ai_generated)
    setEdit(false); setMsg(null)
  }, [data, lang, saved])

  async function generateAI() {
    setBusy('ai'); setMsg(null)
    try {
      const { patient, visit, findings, problems, plan, sections } = data
      const profile = {
        sex: patient.sex, age: ageFrom(patient.dob, visit.visit_date),
        sections: Object.fromEntries((sections || []).map((s) => [s.category, s.content])),
        findings: findings.map(({ category, subcategory, test_name, value_text, value_num, unit, ref_range, flag, interpretation }) =>
          ({ category, subcategory, test_name, value: value_text || value_num, unit, ref_range, flag, interpretation })),
        problems: problems.map(({ id, title, detail, priority }) => ({ id, title, detail, priority })),
        plan: plan.map(({ problem_id, domain, action, target, timeframe }) => ({ problem_id, domain, action, target, timeframe })),
      }
      setContent(await aiAssist({ mode: 'summary', language: lang, profile }))
      setAiUsed(true)
      setEdit(true)
      setMsg({ type: 'ok', text: 'AI ร่างแล้ว ตรวจทานและกดบันทึกก่อนพิมพ์' })
    } catch (e) { setMsg({ type: 'error', text: `AI สรุปไม่สำเร็จ: ${e.message}` }) } finally { setBusy(null) }
  }

  // แปลฉบับอังกฤษที่บันทึกแล้ว เป็นภาษาไทยที่คนไข้อ่านเข้าใจง่าย
  async function translateFromEnglish() {
    const source = toProfileShape(saved.en?.content, 'en')
    if (!source) return
    setBusy('tr'); setMsg(null)
    try {
      setContent(await aiAssist({ mode: 'translate', content: source }))
      setAiUsed(true)
      setEdit(true)
      setMsg({ type: 'ok', text: 'แปลแล้ว ตรวจทานและกดบันทึกก่อนพิมพ์' })
    } catch (e) { setMsg({ type: 'error', text: `แปลไม่สำเร็จ: ${e.message}` }) } finally { setBusy(null) }
  }

  async function save() {
    setBusy('save')
    const { data: row, error } = await supabase.from('patient_summaries')
      .upsert({ visit_id: visitId, language: lang, content, ai_generated: aiUsed }, { onConflict: 'visit_id,language' })
      .select().single()
    setBusy(null)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setSaved((s) => ({ ...s, [lang]: row })); setEdit(false); setMsg({ type: 'ok', text: 'บันทึกสรุปแล้ว' }) }
  }

  if (!data || !content) return <div className="page muted">กำลังโหลด…</div>
  const t = T[lang]
  const { patient, visit } = data
  const words = countWords(content)
  const upd = (path, val) => setContent((c) => setIn(c, path, val))
  const E = ({ path, value, multi, className, placeholder }) => edit
    ? (multi
      ? <textarea className={`e ${className || ''}`} rows={3} defaultValue={value} placeholder={placeholder} onBlur={(e) => upd(path, e.target.value)} />
      : <input className={`e ${className || ''}`} defaultValue={value} placeholder={placeholder} onBlur={(e) => upd(path, e.target.value)} />)
    : <span className={className}>{value}</span>

  return (
    <div className="summary-page">
      <div className="summary-tools no-print">
        <Link to={`/patients/${patient.id}`} className="back">กลับไปโปรไฟล์</Link>
        <div className="seg">
          <button className={lang === 'th' ? 'on' : ''} onClick={() => setLang('th')}>ไทย</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
        </div>
        {lang === 'th' && (
          <button className="btn-quiet" onClick={translateFromEnglish} disabled={!!busy || !saved.en}
            title={saved.en ? 'แปลฉบับอังกฤษที่บันทึกไว้เป็นภาษาไทยแบบเข้าใจง่าย' : 'บันทึกฉบับอังกฤษก่อน จึงจะแปลได้'}>
            {busy === 'tr' ? 'กำลังแปล…' : 'แปลจากฉบับอังกฤษ'}
          </button>
        )}
        <button className="btn-quiet" onClick={generateAI} disabled={!!busy}>{busy === 'ai' ? 'AI กำลังเขียน…' : 'ให้ AI เขียนสรุปใหม่'}</button>
        <button className="btn-quiet" onClick={() => { setContent(buildSummaryFromData(data, lang)); setAiUsed(false) }} disabled={!!busy}>สร้างจากโปรไฟล์ตรง ๆ</button>
        <button className="btn-quiet" onClick={() => setEdit(!edit)}>{edit ? 'ดูตัวอย่าง' : 'แก้ไขข้อความ'}</button>
        <button className="btn-quiet" onClick={save} disabled={!!busy}>บันทึกสรุป</button>
        <button className="btn" onClick={() => { setEdit(false); setTimeout(() => window.print(), 50) }}>พิมพ์</button>
        <span className={`small ${words > 500 ? 'alert inline error' : 'muted'}`}>{words} / 500 คำ</span>
        {msg && <span className={`alert inline ${msg.type}`}>{msg.text}</span>}
        {!saved[lang] && !msg && <span className="muted small">ยังไม่ได้บันทึกฉบับ{lang === 'th' ? 'ภาษาไทย' : 'ภาษาอังกฤษ'}</span>}
      </div>

      <article className="sheet profile-sheet" lang={lang}>
        <header className="sheet-head">
          <div>
            <p className="clinic">{CLINIC_NAME}</p>
            <h1>{t.title}</h1>
          </div>
          <dl className="who-box">
            <div><dt>{lang === 'th' ? 'ชื่อ' : 'Name'}</dt><dd>{patient.first_name} {patient.last_name}</dd></div>
            {patient.dob && <div><dt>{t.age}</dt><dd>{ageFrom(patient.dob, visit.visit_date)} {t.years}</dd></div>}
            {patient.hn && <div><dt>{t.hn}</dt><dd>{patient.hn}</dd></div>}
            <div><dt>{t.date}</dt><dd>{fmtDate(visit.visit_date, lang)}</dd></div>
          </dl>
        </header>

        {(content.intro || edit) && (
          <section className="p-intro">
            <E path={['intro']} value={content.intro} multi placeholder="ภาพรวมสั้น ๆ: จุดดีก่อน แล้วค่อยเรื่องที่ควรโฟกัส" />
          </section>
        )}

        <ol className="p-themes">
          {(content.themes || []).map((th, i) => (
            <li key={i}>
              <h2>
                <span className="p-num">{i + 1}.</span>
                <E path={['themes', i, 'title']} value={th.title} placeholder="หัวข้อ" />
                {edit && <button className="btn-quiet danger no-print" onClick={() => setContent((c) => ({ ...c, themes: c.themes.filter((_, j) => j !== i) }))}>ลบหัวข้อ</button>}
              </h2>
              {(th.body || []).map((para, pi) => (
                <p key={pi}><E path={['themes', i, 'body', pi]} value={para} multi /></p>
              ))}
              {(th.plan || edit) && (
                <p className="p-plan"><strong>{t.plan}:</strong> <E path={['themes', i, 'plan']} value={th.plan} multi placeholder="สิ่งที่ควรทำ (เว้นว่างได้)" /></p>
              )}
            </li>
          ))}
        </ol>
        {edit && (
          <button className="btn-add no-print" onClick={() => setContent((c) => ({ ...c, themes: [...(c.themes || []), { title: '', body: [''], plan: '' }] }))}>เพิ่มหัวข้อ</button>
        )}

        {((content.goals || []).length > 0 || content.follow_up || content.closing) && (
          <section className="p-goals">
            <h2>{t.goals}</h2>
            <ul>
              {(content.goals || []).map((g, i) => (
                <li key={i}><strong>{g.label}:</strong> <E path={['goals', i, 'text']} value={g.text} multi /></li>
              ))}
              {(content.follow_up || edit) && (
                <li><strong>{t.followUp}:</strong> <E path={['follow_up']} value={content.follow_up} multi /></li>
              )}
            </ul>
            {(content.closing || edit) && (
              <p className="p-closing"><E path={['closing']} value={content.closing} multi placeholder="ประโยคปิดท้ายให้กำลังใจ" /></p>
            )}
          </section>
        )}

        <footer className="sheet-foot">
          <div className="sign">
            <span className="line" />
            <span>{t.doctor}: {visit.author?.full_name}{visit.author?.license_no ? ` (${visit.author.license_no})` : ''}</span>
          </div>
          <p>{t.disclaimer}</p>
        </footer>
      </article>
    </div>
  )
}

function setIn(obj, path, val) {
  const copy = Array.isArray(obj) ? [...obj] : { ...obj }
  const [k, ...rest] = path
  copy[k] = rest.length ? setIn(obj[k] ?? {}, rest, val) : val
  return copy
}
