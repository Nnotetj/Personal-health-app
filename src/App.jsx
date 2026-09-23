import { createContext, useContext, useEffect, useState } from 'react'
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { supabase, CLINIC_NAME } from './lib/supabase'
import Login from './pages/Login'
import Patients from './pages/Patients'
import PatientProfile from './pages/PatientProfile'
import VisitEditor from './pages/VisitEditor'
import Summary from './pages/Summary'
import Admin from './pages/Admin'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data))
  }, [session])

  if (session === undefined) return <div className="boot">กำลังโหลด…</div>
  if (!session) {
    // ยังไม่ได้เข้าสู่ระบบ: /login = ฟอร์มเข้าสู่ระบบ, หน้าอื่น = หน้าแนะนำ (public/welcome.html)
    if (window.location.pathname === '/login') return <Login />
    window.location.replace('/welcome.html')
    return <div className="boot">กำลังโหลด…</div>
  }
  if (!profile) return <div className="boot">กำลังโหลดโปรไฟล์…</div>
  if (!profile.is_active) return <Pending email={profile.email} />

  return (
    <AuthCtx.Provider value={{ session, profile }}>
      <Shell>
        <Routes>
          <Route path="/" element={<Patients />} />
          <Route path="/patients/:id" element={<PatientProfile />} />
          <Route path="/patients/:id/visits/new" element={<VisitEditor />} />
          <Route path="/visits/:visitId/edit" element={<VisitEditor />} />
          <Route path="/visits/:visitId/summary" element={<Summary />} />
          {profile.role === 'admin' && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </AuthCtx.Provider>
  )
}

function Shell({ children }) {
  const { profile } = useAuth()
  const loc = useLocation()
  const printMode = loc.pathname.endsWith('/summary')
  return (
    <div className={printMode ? 'shell shell-print' : 'shell'}>
      <header className="topbar no-print">
        <NavLink to="/" className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>{CLINIC_NAME}</span>
        </NavLink>
        <nav>
          <NavLink to="/" end>คนไข้</NavLink>
          {profile.role === 'admin' && <NavLink to="/admin">ผู้ดูแลระบบ</NavLink>}
        </nav>
        <div className="who">
          <span>{profile.full_name || profile.email}</span>
          <button className="btn-quiet" onClick={() => supabase.auth.signOut()}>ออกจากระบบ</button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}

function Pending({ email }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>รอผู้ดูแลระบบอนุมัติ</h1>
        <p>บัญชี {email} ลงทะเบียนแล้ว เมื่อผู้ดูแลระบบอนุมัติ คุณจะเข้าใช้งานได้ทันที</p>
        <button className="btn" onClick={() => location.reload()}>ตรวจสอบอีกครั้ง</button>
        <button className="btn-quiet" onClick={() => supabase.auth.signOut()}>ออกจากระบบ</button>
      </div>
    </div>
  )
}
