import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'
import { CATEGORIES, CAT, DOMAINS, FLAGS, PRIORITIES, ageFrom, fmtDate, isAbnormal, prioritySort } from '../lib/constants'
import PatientForm from '../components/PatientForm'
import ShareDialog from '../components/ShareDialog'
import Sparkline from '../components/Sparkline'
import { trendKey } from '../lib/catalog'

export default function PatientProfile() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [patient, setPatient] = useState(null)
  const [visits, setVisits] = useState([])
  const [allFindings, setAllFindings] = useState([])
  const [sections, setSections] = useState([])
  const [problems, setProblems] = useState([])
  const [plan, setPlan] = useState([])
  const [access, setAccess] = useState(null)
  const [visitId, setVisitId] = useState(null)
  const [pertinentOnly, setPertinentOnly] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [notFound, setNotFound] = useState(false)

  async function load() {
    const [{ data: p }, { data: v }, { data: f }, { data: a }, { data: sec }] = await Promise.all([
      supabase.from('patients').select('*').eq('id', id).maybeSingle(),
      supabase.from('visits').select('*, author:profiles!visits_created_by_fkey(full_name)').eq('patient_id', id).order('visit_date', { ascending: false }),
      supabase.from('findings').select('*').eq('patient_id', id).order('sort_order'),
      supabase.from('patient_access').select('level').eq('patient_id', id).eq('doctor_id', profile.id).maybeSingle(),
      supabase.from('visit_sections').select('*').eq('patient_id', id),
    ])
    if (!p) { setNotFound(true); return }
    setPatient(p); setVisits(v || []); setAllFindings(f || []); setAccess(a); setSections(sec || [])
    setVisitId((cur) => cur || v?.[0]?.id || null)
  }
  useEffect(() => { load() }, [id])

  useEffect(() => {
    if (!visitId) { setProblems([]); setPlan([]); return }
    Promise.all([
      supabase.from('problems').select('*').eq('visit_id', visitId),
      supabase.from('plan_items').select('*').eq('visit_id', visitId).order('sort_order'),
    ]).then(([{ data: pr }, { data: pl }]) => { setProblems((pr || []).sort(prioritySort)); setPlan(pl || []) })
  }, [visitId])

  const visit = visits.find((v) => v.id === visitId)
  const isOwner = patient && (patient.owner_id === profile.id || profile.role === 'admin')
  const canEdit = isOwner || access?.level === 'edit'

  // trend series per test name across visits
  const trends = useMemo(() => {
    const dateOf = Object.fromEntries(visits.map((v) => [v.id, v.visit_date]))
    const m = {}
    allFindings.forEach((f) => {
      if (f.value_num == null) return
      const k = trendKey(f)
      ;(m[k] ||= []).push({ date: dateOf[f.visit_id], value: Number(f.value_num), visit_id: f.visit_id })
    })
    Object.values(m).forEach((arr) => arr.sort((a, b) => a.date.localeCompare(b.date)))
    return m
  }, [allFindings, visits])

  const findings = allFindings.filter((f) => f.visit_id === visitId)
  const shown = pertinentOnly ? findings.filter(isAbnormal) : findings

  if (notFound) return <div className="page"><p>ไม่พบคนไข้ หรือคุณไม่มีสิทธิ์เข้าถึงเคสนี้</p><Link to="/">กลับไปหน้าคนไข้</Link></div>
  if (!patient) return <div className="page muted">กำลังโหลด…</div>

  return (
    <div className="page">
      <Link to="/" className="back">คนไข้ทั้งหมด</Link>

      <section className="pt-head">
        <div>
          <h1>{patient.first_name} {patient.last_name}</h1>
          <p className="muted">
            {patient.hn || 'ไม่มี HN'}
            {patient.dob && `, ${ageFrom(patient.dob)} ปี`}
            {patient.sex && `, ${{ M: 'ชาย', F: 'หญิง', other: 'อื่น ๆ' }[patient.sex]}`}
          </p>
        </div>
        <div className="actions">
          {canEdit && <button className="btn-quiet" onClick={() => setEditing(true)}>แก้ไขข้อมูลคนไข้</button>}
          {isOwner && <button className="btn-quiet" onClick={() => setSharing(true)}>แชร์เคส</button>}
          {canEdit && <Link className="btn" to={`/patients/${id}/visits/new`}>เพิ่มผลตรวจใหม่</Link>}
        </div>
      </section>

      {patient.background && <p className="background">{patient.background}</p>}

      {visits.length === 0 ? (
        <div className="empty">
          <p>ยังไม่มีผลตรวจสุขภาพของคนไข้คนนี้</p>
          {canEdit && <Link className="btn" to={`/patients/${id}/visits/new`}>เพิ่มผลตรวจครั้งแรก</Link>}
        </div>
      ) : (
        <>
          <div className="visit-strip" role="tablist" aria-label="ครั้งที่ตรวจ">
            {visits.map((v) => (
              <button key={v.id} role="tab" aria-selected={v.id === visitId} className={v.id === visitId ? 'on' : ''} onClick={() => setVisitId(v.id)}>
                <strong>{fmtDate(v.visit_date)}</strong>
                <span>{v.package_name || 'Check-up'}{v.status === 'draft' ? ', ร่าง' : ''}</span>
              </button>
            ))}
          </div>

          <div className="profile-grid">
            <div className="profile-main">
              <div className="row-between">
                <p className="muted small">
                  ค่าติดตาม {findings.length} รายการ, ผิดปกติ {findings.filter(isAbnormal).length} รายการ
                  {visit?.author?.full_name && `, บันทึกโดย ${visit.author.full_name}`}
                </p>
                <label className="switch">
                  <input type="checkbox" checked={pertinentOnly} onChange={(e) => setPertinentOnly(e.target.checked)} />
                  แสดงเฉพาะผลผิดปกติ
                </label>
              </div>

              {CATEGORIES.map((c) => {
                const rows = shown.filter((f) => f.category === c.key)
                const abn = findings.filter((f) => f.category === c.key && isAbnormal(f)).length
                const text = sections.find((s) => s.visit_id === visitId && s.category === c.key)?.content
                return (
                  <section key={c.key} className={`cat cat-${c.key}`}>
                    <header>
                      <h2>{c.name}</h2>
                      <span className="muted small">{c.hint}</span>
                      {abn > 0 && <span className="count">{abn} ผิดปกติ</span>}
                    </header>
                    {text ? <div className="sec-body">{text.split('\n').map((line, i) => (
                      <p key={i} className={line.trim().startsWith('สรุป') ? 'sec-sum' : ''}>{line}</p>))}</div> : null}
                    {rows.length === 0 ? (text ? null : <p className="muted small cat-empty">ไม่มีข้อมูลในหมวดนี้</p>) : (
                      <div className="table-scroll">
                        <table className="findings">
                          <thead><tr><th>การตรวจ</th><th>ผล</th><th>ค่าอ้างอิง</th><th>สถานะ</th><th>แนวโน้ม</th><th>การแปลผล</th></tr></thead>
                          <tbody>
                            {rows.map((f) => {
                              const series = trends[trendKey(f)] || []
                              return (
                                <tr key={f.id} className={isAbnormal(f) ? 'abn' : ''}>
                                  <td><strong>{f.test_name}</strong>{f.subcategory && <span className="sub-cat">{f.subcategory}</span>}</td>
                                  <td className="num">{f.value_text || f.value_num}{f.unit && <span className="unit"> {f.unit}</span>}</td>
                                  <td className="muted num">{f.ref_range}</td>
                                  <td><span className={`flag flag-${f.flag}`}>{FLAGS[f.flag]}</span></td>
                                  <td>{series.length > 1 ? <Sparkline points={series} current={visitId} /> : <span className="muted small">ครั้งแรก</span>}</td>
                                  <td className="interp">{f.interpretation}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )
              })}
              {(() => {
                const text = sections.find((s) => s.visit_id === visitId && s.category === 'integrated')?.content
                return text ? (
                  <section className="cat cat-integrated">
                    <header><h2>Integrated Profile</h2></header>
                    <div className="sec-body">{text.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>
                  </section>
                ) : null
              })()}
            </div>

            <aside className="profile-side">
              <section className="panel">
                <h2>ปัญหาเรียงตามความสำคัญ</h2>
                {problems.length === 0 ? <p className="muted small">ยังไม่มีรายการปัญหา</p> : (
                  <ol className="problems">
                    {problems.map((p) => (
                      <li key={p.id} className={`prio-${p.priority}`}>
                        <div className="prob-title">
                          <strong>{p.title}</strong>
                          <span className={`prio prio-${p.priority}`}>{PRIORITIES[p.priority].label}</span>
                        </div>
                        {p.detail && <p className="small">{p.detail}</p>}
                        {p.category && <span className={`cat-dot cat-${p.category}`}>{CAT[p.category].name}</span>}
                        <ul className="plan-under">
                          {plan.filter((x) => x.problem_id === p.id).map((x) => (
                            <li key={x.id}><span className="domain">{DOMAINS[x.domain].label}</span> {x.action}{x.target && `, เป้า ${x.target}`}{x.timeframe && `, ${x.timeframe}`}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                )}
                {plan.some((x) => !x.problem_id) && (
                  <>
                    <h3 className="sub">แผนทั่วไป</h3>
                    <ul className="plan-under">
                      {plan.filter((x) => !x.problem_id).map((x) => (
                        <li key={x.id}><span className="domain">{DOMAINS[x.domain].label}</span> {x.action}{x.timeframe && `, ${x.timeframe}`}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              {visit?.doctor_note && (
                <section className="panel">
                  <h2>บันทึกแพทย์</h2>
                  <p className="small pre">{visit.doctor_note}</p>
                </section>
              )}

              <div className="side-actions">
                {canEdit && <Link className="btn-quiet" to={`/visits/${visitId}/edit`}>แก้ไขผลตรวจครั้งนี้</Link>}
                <Link className="btn" to={`/visits/${visitId}/summary`}>สรุป 1 หน้าให้คนไข้</Link>
              </div>
            </aside>
          </div>
        </>
      )}

      {editing && <PatientForm patient={patient} onClose={() => setEditing(false)} onSaved={(p) => { setPatient(p); setEditing(false) }} />}
      {sharing && <ShareDialog patient={patient} onClose={() => setSharing(false)} />}
    </div>
  )
}
