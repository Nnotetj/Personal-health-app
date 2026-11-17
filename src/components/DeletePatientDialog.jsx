import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from './Modal'

// Admin-only: permanently deletes a patient and (via ON DELETE CASCADE) all
// their visits, findings, problems, plans, summaries and sharing grants.
export default function DeletePatientDialog({ patient, onClose, onDeleted }) {
  const fullName = `${patient.first_name} ${patient.last_name}`.trim()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function remove() {
    setBusy(true); setErr(null)
    // .select() returns the deleted rows, so we can detect a silent RLS refusal
    const { data, error } = await supabase.from('patients').delete().eq('id', patient.id).select('id')
    setBusy(false)
    if (error) return setErr(error.message)
    if (!data || data.length === 0) return setErr('ลบไม่สำเร็จ: คุณอาจไม่มีสิทธิ์ลบคนไข้รายนี้')
    onDeleted()
  }

  return (
    <Modal title="ลบคนไข้" onClose={onClose}>
      <p>
        ต้องการลบ <strong>{fullName}</strong>{patient.hn ? ` (HN ${patient.hn})` : ''} ใช่หรือไม่
      </p>
      <p className="alert error">
        การลบถาวรและกู้คืนไม่ได้ ผลตรวจ ปัญหา แผน สรุปคนไข้ และการแชร์เคสทั้งหมดของคนไข้รายนี้จะถูกลบด้วย
      </p>
      <label>
        พิมพ์ชื่อ “{fullName}” เพื่อยืนยัน
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
      </label>
      {err && <p className="alert error">{err}</p>}
      <div className="actions" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
        <button className="btn-quiet" onClick={onClose} disabled={busy}>ยกเลิก</button>
        <button className="btn-quiet danger" onClick={remove} disabled={busy || typed.trim() !== fullName}>
          {busy ? 'กำลังลบ…' : 'ลบถาวร'}
        </button>
      </div>
    </Modal>
  )
}
