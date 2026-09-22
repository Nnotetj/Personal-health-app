import { useState } from 'react'
import { supabase, CLINIC_NAME } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ email: '', password: '', full_name: '', license_no: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { email, password, full_name, license_no } = form
    const { error } = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { full_name, license_no } } })
    setBusy(false)
    if (error) setMsg({ type: 'error', text: error.message })
    else if (mode === 'signup') setMsg({ type: 'ok', text: 'ลงทะเบียนแล้ว ตรวจอีเมลเพื่อยืนยัน จากนั้นรอผู้ดูแลระบบอนุมัติ' })
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <span className="brand-mark big" aria-hidden="true"><i /><i /><i /><i /></span>
        <h1>{CLINIC_NAME}</h1>
        <p className="muted">Personal health profile สำหรับแพทย์</p>

        {mode === 'signup' && (
          <>
            <label>ชื่อ-นามสกุล<input required value={form.full_name} onChange={set('full_name')} /></label>
            <label>เลขใบประกอบวิชาชีพ<input value={form.license_no} onChange={set('license_no')} /></label>
          </>
        )}
        <label>อีเมล<input type="email" required autoComplete="email" value={form.email} onChange={set('email')} /></label>
        <label>รหัสผ่าน<input type="password" required minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={form.password} onChange={set('password')} /></label>

        {msg && <p className={msg.type === 'error' ? 'alert error' : 'alert ok'}>{msg.text}</p>}

        <button className="btn" disabled={busy}>{mode === 'signin' ? 'เข้าสู่ระบบ' : 'ลงทะเบียน'}</button>
        <button type="button" className="btn-quiet" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg(null) }}>
          {mode === 'signin' ? 'ยังไม่มีบัญชี? ลงทะเบียนแพทย์ใหม่' : 'มีบัญชีแล้ว? เข้าสู่ระบบ'}
        </button>
      </form>
    </div>
  )
}
