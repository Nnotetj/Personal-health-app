import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from './Modal'

export default function PatientForm({ patient, onClose, onSaved }) {
  const [f, setF] = useState(patient || { first_name: '', last_name: '', hn: '', sex: '', dob: '', phone: '', email: '', background: '' })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function save(e) {
    e.preventDefault()
    setBusy(true); setErr(null)
    const payload = {
      first_name: f.first_name, last_name: f.last_name, hn: f.hn || null, sex: f.sex || null,
      dob: f.dob || null, phone: f.phone || null, email: f.email || null, background: f.background || null,
    }
    const q = patient
      ? supabase.from('patients').update(payload).eq('id', patient.id).select().single()
      : supabase.from('patients').insert(payload).select().single()
    const { data, error } = await q
    setBusy(false)
    if (error) setErr(error.code === '23505' ? 'HN นี้มีอยู่ในระบบแล้ว' : error.message)
    else onSaved(data)
  }

  return (
    <Modal title={patient ? 'แก้ไขข้อมูลคนไข้' : 'เพิ่มคนไข้'} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <label>ชื่อ<input required value={f.first_name} onChange={set('first_name')} /></label>
        <label>นามสกุล<input value={f.last_name} onChange={set('last_name')} /></label>
        <label>HN<input value={f.hn || ''} onChange={set('hn')} /></label>
        <label>เพศ
          <select value={f.sex || ''} onChange={set('sex')}>
            <option value="">ไม่ระบุ</option><option value="M">ชาย</option><option value="F">หญิง</option><option value="other">อื่น ๆ</option>
          </select>
        </label>
        <label>วันเกิด<input type="date" value={f.dob || ''} onChange={set('dob')} /></label>
        <label>โทรศัพท์<input value={f.phone || ''} onChange={set('phone')} /></label>
        <label className="span-2">อีเมล<input type="email" value={f.email || ''} onChange={set('email')} /></label>
        <label className="span-2">ประวัติพื้นฐาน (โรคประจำตัว ยา แพ้ยา ประวัติครอบครัว ไลฟ์สไตล์)
          <textarea rows={4} value={f.background || ''} onChange={set('background')} />
        </label>
        {err && <p className="alert error span-2">{err}</p>}
        <div className="actions span-2">
          <button type="button" className="btn-quiet" onClick={onClose}>ยกเลิก</button>
          <button className="btn" disabled={busy}>บันทึกคนไข้</button>
        </div>
      </form>
    </Modal>
  )
}
