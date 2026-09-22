import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, aiAssist, CLINIC_NAME } from '../lib/supabase'
import { CATEGORIES, DOMAINS, PRIORITIES, T, ageFrom, buildSummaryFromData, fmtDate, isAbnormal, prioritySort } from '../lib/constants'

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
      const [{ data: patient }, { data: findings }, { data: problems }, { data: plan }, { data: sums }] = await Promise.all([
        supabase.from('patients').select('*').eq('id', visit.patient_id).single(),
        supabase.from('findings').select('*').eq('visit_id', visitId).order('sort_order'),
        supabase.from('problems').select('*').eq('visit_id', visitId),
        supabase.from('plan_items').select('*').eq('visit_id', visitId).order('sort_order'),
        supabase.from('patient_summaries').select('*').eq('visit_id', visitId),
      ])
      setData({ visit, patient, findings: findings || [], problems: (problems || []).sort(prioritySort), plan: plan || [] })
      setSaved(Object.fromEntries((sums || []).map((s) => [s.language, s])))
    })()
  }, [visitId])

  useEffect(() => {
    if (!data) return
    setContent(saved[lang]?.content || buildSummaryFromData(data, lang))
    setAiUsed(!!saved[lang]?.ai_generated)
    setEdit(false); setMsg(null)
  }, [data, lang, saved])

  async function generateAI() {
    setBusy('ai'); setMsg(null)
    try {
      const { patient, visit, findings, problems, plan } = data
      const profile = {
        sex: patient.sex, age: ageFrom(patient.dob, visit.visit_date),
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
  const { patient, visit, findings } = data
  const upd = (path, val) => setContent((c) => setIn(c, path, val))
  const E = ({ path, value, multi, className, placeholder }) => edit
    ? (multi
      ? <textarea className={`e ${className || ''}`} rows={2} defaultValue={value} placeholder={placeholder} onBlur={(e) => upd(path, e.target.value)} />
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
        <button className="btn-quiet" onClick={generateAI} disabled={!!busy}>{busy === 'ai' ? 'AI กำลังเขียน…' : 'ให้ AI เขียนสรุปใหม่'}</button>
        <button className="btn-quiet" onClick={() => { setContent(buildSummaryFromData(data, lang)); setAiUsed(false) }} disabled={!!busy}>สร้างจากโปรไฟล์ตรง ๆ</button>
        <button className="btn-quiet" onClick={() => setEdit(!edit)}>{edit ? 'ดูตัวอย่าง' : 'แก้ไขข้อความ'}</button>
        <button className="btn-quiet" onClick={save} disabled={!!busy}>บันทึกสรุป</button>
        <button className="btn" onClick={() => { setEdit(false); setTimeout(() => window.print(), 50) }}>พิมพ์</button>
        {msg && <span className={`alert inline ${msg.type}`}>{msg.text}</span>}
        {!saved[lang] && !msg && <span className="muted small">ยังไม่ได้บันทึกฉบับ{lang === 'th' ? 'ภาษาไทย' : 'ภาษาอังกฤษ'}</span>}
      </div>

      <article className="sheet" lang={lang}>
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

        <div className="coverage">
          {CATEGORIES.map((c) => {
            const all = findings.filter((f) => f.category === c.key)
            const abn = all.filter(isAbnormal).length
            return (
              <div key={c.key} className={`cov cat-${c.key}`}>
                <strong>{c[lang]}</strong>
                <span>{all.length === 0 ? (lang === 'th' ? 'ไม่ได้ตรวจ' : 'Not tested')
                  : abn === 0 ? (lang === 'th' ? `${all.length} รายการ ปกติทั้งหมด` : `${all.length} tests, all in range`)
                    : (lang === 'th' ? `${all.length} รายการ ควรดูแล ${abn}` : `${all.length} tests, ${abn} to work on`)}</span>
              </div>
            )
          })}
        </div>

        <section className="headline">
          <E path={['headline']} value={content.headline} multi className="headline-text" />
        </section>

        <div className="sheet-cols">
          <section>
            <h2>{t.priorities}</h2>
            <ol className="s-prios">
              {(content.priorities || []).map((p, i) => (
                <li key={i} className={`lvl-${p.level}`}>
                  <div className="s-prio-head">
                    <E path={['priorities', i, 'title']} value={p.title} className="s-prio-title" />
                    <span className="s-lvl">{PRIORITIES[p.level]?.[lang] || ''}</span>
                  </div>
                  <E path={['priorities', i, 'why']} value={p.why} multi className="s-why" />
                </li>
              ))}
            </ol>
          </section>

          {(content.key_numbers || []).length > 0 && (
            <section>
              <h2>{t.numbers}</h2>
              <table className="s-numbers">
                <tbody>
                  {content.key_numbers.map((k, i) => (
                    <tr key={i}>
                      <td><E path={['key_numbers', i, 'label']} value={k.label} /></td>
                      <td className="num"><E path={['key_numbers', i, 'value']} value={k.value} /></td>
                      <td><span className={`s-status st-${k.status}`}>{t.status[k.status] || k.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>

        <section>
          <h2>{t.plan}</h2>
          <div className="s-plan">
            {(content.plan || []).map((g, gi) => (
              <div key={gi} className="s-plan-group">
                <h3>{DOMAINS[g.domain]?.[lang] || g.domain}</h3>
                <ul>
                  {(g.actions || []).map((a, ai) => <li key={ai}><E path={['plan', gi, 'actions', ai]} value={a} multi /></li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {(content.next_steps || []).length > 0 && (
          <section>
            <h2>{t.next}</h2>
            <table className="s-next">
              <tbody>
                {content.next_steps.map((n, i) => (
                  <tr key={i}>
                    <td><E path={['next_steps', i, 'what']} value={n.what} /></td>
                    <td className="when"><E path={['next_steps', i, 'when']} value={n.when} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
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
