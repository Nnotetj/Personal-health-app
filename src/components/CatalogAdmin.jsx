import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORIES, CAT } from '../lib/constants'
import { invalidateCatalog, refText } from '../lib/catalog'
import Modal from './Modal'

const NUM_FIELDS = ['ref_low', 'ref_high', 'ref_low_f', 'ref_high_f', 'low_cutoff', 'high_cutoff']
const blank = { code: '', name: '', category: 'biomarker', subcategory: '', unit: '', ref_low: '', ref_high: '', ref_low_f: '', ref_high_f: '', low_cutoff: '', high_cutoff: '', ref_text: '', aliases: '', is_active: true, sort_order: 999 }

export default function CatalogAdmin() {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [edit, setEdit] = useState(null)

  async function load() {
    const { data } = await supabase.from('test_catalog').select('*').order('sort_order')
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter((r) => (cat === 'all' || r.category === cat) &&
      (!s || [r.code, r.name, ...(r.aliases || [])].join(' ').toLowerCase().includes(s)))
  }, [rows, q, cat])

  return (
    <>
      <div className="toolbar">
        <input className="search" placeholder="ค้นหาชื่อ, code หรือชื่อเรียกอื่น" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto' }} aria-label="หมวด">
          <option value="all">ทุกหมวด</option>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
        <button className="btn" onClick={() => setEdit({ ...blank, _new: true, category: cat === 'all' ? 'biomarker' : cat })}>เพิ่มการตรวจ</button>
      </div>
      <p className="muted small">ค่าอ้างอิงเริ่มต้นเป็นค่าทั่วไปของผู้ใหญ่ ควรปรับให้ตรงกับแล็บที่คลินิกใช้ ชื่อเรียกอื่นช่วยให้ระบบจับคู่ชื่อที่หมอหรือ AI พิมพ์มา</p>

      <div className="table-scroll panel" style={{ padding: 0 }}>
        <table className="findings catalog-table">
          <thead><tr><th>ชื่อมาตรฐาน</th><th>หมวด</th><th>หน่วย</th><th>ค่าอ้างอิง (ชาย / หญิง)</th><th>ชื่อเรียกอื่น</th><th></th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.code} className={r.is_active ? '' : 'inactive'}>
                <td><strong>{r.name}</strong><span className="sub-cat">{r.code}</span></td>
                <td className={`cat-${r.category}`}><span className="cat-dot">{CAT[r.category].name}</span><span className="sub-cat">{r.subcategory}</span></td>
                <td>{r.unit}</td>
                <td className="num">{refText(r, 'M') || '-'}{(r.ref_low_f != null || r.ref_high_f != null) && ` / ${refText(r, 'F')}`}</td>
                <td className="small muted">{(r.aliases || []).join(', ')}</td>
                <td><button className="btn-quiet" onClick={() => setEdit({ ...r, aliases: (r.aliases || []).join(', ') })}>แก้ไข</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && <CatalogForm row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); invalidateCatalog(); load() }} />}
    </>
  )
}

function CatalogForm({ row, onClose, onSaved }) {
  const [f, setF] = useState(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? ''])))
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const subs = CAT[f.category]?.subs || []

  async function save(e) {
    e.preventDefault(); setErr(null)
    const payload = {
      code: f.code.trim().toUpperCase(), name: f.name.trim(), category: f.category,
      subcategory: f.subcategory || null, unit: f.unit || null, ref_text: f.ref_text || null,
      aliases: f.aliases.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
      is_active: f.is_active, sort_order: Number(f.sort_order) || 999,
      ...Object.fromEntries(NUM_FIELDS.map((k) => [k, f[k] === '' ? null : Number(f[k])])),
    }
    const { error } = row._new
      ? await supabase.from('test_catalog').insert(payload)
      : await supabase.from('test_catalog').update(payload).eq('code', row.code)
    if (error) setErr(error.code === '23505' ? 'code หรือชื่อนี้มีอยู่แล้ว' : error.message); else onSaved()
  }

  return (
    <Modal title={row._new ? 'เพิ่มการตรวจใน catalog' : `แก้ไข ${row.name}`} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid catalog-form">
        <label>Code<input required value={f.code} onChange={set('code')} placeholder="เช่น LDL" /></label>
        <label>ชื่อมาตรฐาน<input required value={f.name} onChange={set('name')} placeholder="เช่น LDL-C" /></label>
        <label>หมวด
          <select value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select>
        </label>
        <label>หมวดย่อย
          <select value={f.subcategory} onChange={set('subcategory')}>
            <option value="">ไม่ระบุ</option>{subs.map((s) => <option key={s}>{s}</option>)}
            {f.subcategory && !subs.includes(f.subcategory) && <option>{f.subcategory}</option>}
          </select>
        </label>
        <label>หน่วย<input value={f.unit} onChange={set('unit')} /></label>
        <label>ค่าอ้างอิงแบบข้อความ<input value={f.ref_text} onChange={set('ref_text')} placeholder="ใช้เมื่อไม่มีช่วงตัวเลข" /></label>

        <fieldset className="span-2 ranges">
          <legend>ช่วงค่าอ้างอิง (เว้นว่างได้)</legend>
          <label>ต่ำสุด<input inputMode="decimal" value={f.ref_low} onChange={set('ref_low')} /></label>
          <label>สูงสุด<input inputMode="decimal" value={f.ref_high} onChange={set('ref_high')} /></label>
          <label>ต่ำสุด (หญิง)<input inputMode="decimal" value={f.ref_low_f} onChange={set('ref_low_f')} /></label>
          <label>สูงสุด (หญิง)<input inputMode="decimal" value={f.ref_high_f} onChange={set('ref_high_f')} /></label>
          <label>ต่ำกว่านี้ = Low<input inputMode="decimal" value={f.low_cutoff} onChange={set('low_cutoff')} /></label>
          <label>ตั้งแต่ค่านี้ = High<input inputMode="decimal" value={f.high_cutoff} onChange={set('high_cutoff')} /></label>
          <p className="muted small">ระหว่างขอบช่วงอ้างอิงกับ cutoff ระบบจะแนะนำเป็น Borderline เช่น HbA1c สูงสุด 5.6, High ตั้งแต่ 6.5</p>
        </fieldset>

        <label className="span-2">ชื่อเรียกอื่น (คั่นด้วย ,)<input value={f.aliases} onChange={set('aliases')} placeholder="ldl, ldl-c, direct ldl" /></label>
        <label className="switch"><input type="checkbox" checked={!!f.is_active} onChange={set('is_active')} />ใช้งาน</label>
        <label>ลำดับ<input inputMode="numeric" value={f.sort_order} onChange={set('sort_order')} /></label>
        {err && <p className="alert error span-2">{err}</p>}
        <div className="actions span-2">
          <button type="button" className="btn-quiet" onClick={onClose}>ยกเลิก</button>
          <button className="btn">บันทึกการตรวจ</button>
        </div>
      </form>
    </Modal>
  )
}
