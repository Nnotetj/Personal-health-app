import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'
import Modal from './Modal'

export default function ShareDialog({ patient, onClose }) {
  const { profile } = useAuth()
  const [doctors, setDoctors] = useState([])
  const [shares, setShares] = useState([])
  const [pick, setPick] = useState('')
  const [level, setLevel] = useState('view')
  const [err, setErr] = useState(null)

  async function load() {
    const [{ data: d }, { data: s }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').eq('is_active', true).order('full_name'),
      supabase.from('patient_access').select('doctor_id, level, doctor:profiles!patient_access_doctor_id_fkey(full_name, email)').eq('patient_id', patient.id),
    ])
    setDoctors((d || []).filter((x) => x.id !== patient.owner_id))
    setShares(s || [])
  }
  useEffect(() => { load() }, [])

  async function grant() {
    if (!pick) return
    setErr(null)
    const { error } = await supabase.from('patient_access')
      .upsert({ patient_id: patient.id, doctor_id: pick, level, granted_by: profile.id })
    if (error) setErr(error.message); else { setPick(''); load() }
  }
  async function revoke(doctor_id) {
    await supabase.from('patient_access').delete().eq('patient_id', patient.id).eq('doctor_id', doctor_id)
    load()
  }
  const available = doctors.filter((d) => !shares.some((s) => s.doctor_id === d.id))

  return (
    <Modal title={`แชร์เคส ${patient.first_name} ${patient.last_name}`} onClose={onClose}>
      <div className="share-row">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="เลือกแพทย์">
          <option value="">เลือกแพทย์</option>
          {available.map((d) => <option key={d.id} value={d.id}>{d.full_name || d.email}</option>)}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="สิทธิ์">
          <option value="view">ดูได้อย่างเดียว</option>
          <option value="edit">ดูและแก้ไขได้</option>
        </select>
        <button className="btn" onClick={grant} disabled={!pick}>แชร์</button>
      </div>
      {err && <p className="alert error">{err}</p>}
      <h3 className="sub">แพทย์ที่เข้าถึงเคสนี้</h3>
      {shares.length === 0 ? <p className="muted">ยังไม่ได้แชร์ให้ใคร</p> : (
        <ul className="plain-list">
          {shares.map((s) => (
            <li key={s.doctor_id}>
              <span>{s.doctor?.full_name || s.doctor?.email}</span>
              <span className="tag">{s.level === 'edit' ? 'แก้ไขได้' : 'ดูได้'}</span>
              <button className="btn-quiet danger" onClick={() => revoke(s.doctor_id)}>ยกเลิกการแชร์</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
