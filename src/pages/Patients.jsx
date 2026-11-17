import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'
import { ageFrom, fmtDate } from '../lib/constants'
import PatientForm from '../components/PatientForm'

export default function Patients() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [scope, setScope] = useState('all')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)

  const [loadErr, setLoadErr] = useState(null)

  async function load() {
    setLoading(true); setLoadErr(null)
    const { data, error } = await supabase
      .from('patients')
      .select('*, owner:profiles!patients_owner_id_fkey(full_name), visits(id, visit_date, status)')
      .order('updated_at', { ascending: false })
    if (error) setLoadErr(error.message)
    else setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows
      .filter((p) => scope === 'all' || (scope === 'mine' ? p.owner_id === profile.id : p.owner_id !== profile.id))
      .filter((p) => !s || `${p.first_name} ${p.last_name} ${p.hn ?? ''}`.toLowerCase().includes(s))
      .map((p) => ({ ...p, last: [...(p.visits || [])].sort((a, b) => b.visit_date.localeCompare(a.visit_date))[0] }))
  }, [rows, q, scope, profile.id])

  return (
    <div className="page">
      <div className="page-head">
        <h1>คนไข้</h1>
        <button className="btn" onClick={() => setCreating(true)}>เพิ่มคนไข้</button>
      </div>

      <div className="toolbar">
        <input className="search" type="search" aria-label="ค้นหาคนไข้ด้วยชื่อหรือ HN" placeholder="ค้นหาชื่อหรือ HN" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="แสดงคนไข้">
          {[['all', 'ทั้งหมด'], ['mine', 'ของฉัน'], ['shared', profile.role === 'admin' ? 'ของแพทย์อื่น' : 'แชร์กับฉัน']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={scope === k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>
          ))}
        </div>
      </div>

      {loading ? <p className="muted" role="status">กำลังโหลดรายชื่อคนไข้…</p> : loadErr ? (
        <div className="empty" role="alert">
          <p>โหลดรายชื่อคนไข้ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง</p>
          <p className="muted small">{loadErr}</p>
          <button type="button" className="btn" onClick={load}>ลองอีกครั้ง</button>
        </div>
      ) : list.length === 0 ? (
        <div className="empty">
          <p>ยังไม่มีคนไข้ในรายการนี้</p>
          <button className="btn" onClick={() => setCreating(true)}>เพิ่มคนไข้คนแรก</button>
        </div>
      ) : (
        <ul className="patient-list">
          {list.map((p) => (
            <li key={p.id}>
              <Link to={`/patients/${p.id}`}>
                <div className="pl-name">
                  <strong>{p.first_name} {p.last_name}</strong>
                  <span className="muted">{p.hn || 'ไม่มี HN'}{p.dob ? `, ${ageFrom(p.dob)} ปี` : ''}{p.sex ? `, ${p.sex}` : ''}</span>
                </div>
                <div className="pl-meta">
                  {p.last
                    ? <span>ตรวจล่าสุด {fmtDate(p.last.visit_date)}{p.last.status === 'draft' && <em className="tag draft">ร่าง</em>}</span>
                    : <span className="muted">ยังไม่มีผลตรวจ</span>}
                  {p.owner_id !== profile.id && <span className="tag">ดูแลโดย {p.owner?.full_name}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <PatientForm
          onClose={() => setCreating(false)}
          onSaved={(p) => { setCreating(false); nav(`/patients/${p.id}`) }}
        />
      )}
    </div>
  )
}
