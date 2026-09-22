import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'
import { fmtDate } from '../lib/constants'
import CatalogAdmin from '../components/CatalogAdmin'

export default function Admin() {
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('doctors')

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  async function update(id, patch) {
    setErr(null)
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) setErr(error.message); else load()
  }

  const pending = rows.filter((r) => !r.is_active)
  const active = rows.filter((r) => r.is_active)

  return (
    <div className="page">
      <div className="page-head">
        <h1>ผู้ดูแลระบบ</h1>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'doctors'} className={tab === 'doctors' ? 'on' : ''} onClick={() => setTab('doctors')}>แพทย์</button>
          <button role="tab" aria-selected={tab === 'catalog'} className={tab === 'catalog' ? 'on' : ''} onClick={() => setTab('catalog')}>Test catalog</button>
        </div>
      </div>
      {err && <p className="alert error">{err}</p>}
      {tab === 'catalog' ? <CatalogAdmin /> : <>

      <h2 className="sub">รออนุมัติ ({pending.length})</h2>
      {pending.length === 0 ? <p className="muted">ไม่มีบัญชีที่รออนุมัติ</p> : (
        <ul className="plain-list">
          {pending.map((r) => (
            <li key={r.id}>
              <span><strong>{r.full_name || 'ไม่ระบุชื่อ'}</strong> <span className="muted">{r.email}{r.license_no && `, ${r.license_no}`}, สมัคร {fmtDate(r.created_at)}</span></span>
              <button className="btn" onClick={() => update(r.id, { is_active: true })}>อนุมัติ</button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="sub">แพทย์ที่ใช้งานอยู่ ({active.length})</h2>
      <ul className="plain-list">
        {active.map((r) => (
          <li key={r.id}>
            <span><strong>{r.full_name || r.email}</strong> <span className="muted">{r.email}</span></span>
            <select value={r.role} disabled={r.id === profile.id} onChange={(e) => update(r.id, { role: e.target.value })} aria-label="บทบาท">
              <option value="doctor">Doctor</option>
              <option value="admin">Admin</option>
            </select>
            {r.id !== profile.id && <button className="btn-quiet danger" onClick={() => update(r.id, { is_active: false })}>ระงับบัญชี</button>}
          </li>
        ))}
      </ul>
      </>}
    </div>
  )
}
