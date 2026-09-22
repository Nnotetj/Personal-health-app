# Personal Health Profile

Web app สำหรับแพทย์: รวมผลตรวจ full wellness package เป็น Personal health profile 4 หมวด
(Conventional, Multiomic, Physiologic/functional, Imaging) และพิมพ์สรุป 1 หน้าให้คนไข้ (ไทย/อังกฤษ)

## โครงสร้าง

```
supabase/schema.sql                 ตาราง, enum, trigger, RLS, RPC save_visit
supabase/functions/ai-assist/       Edge Function เรียก Claude (เก็บ API key ฝั่ง server)
src/pages/Login.jsx                 เข้าสู่ระบบ / ลงทะเบียนแพทย์
src/pages/Patients.jsx              รายชื่อคนไข้ (ของฉัน / แชร์กับฉัน)
src/pages/PatientProfile.jsx        Personal health profile สำหรับแพทย์ + แนวโน้มข้ามครั้งตรวจ
src/pages/VisitEditor.jsx           พิมพ์ free text > AI ร่าง > แพทย์แก้ในฟอร์ม > บันทึก
src/pages/Summary.jsx               สรุป 1 หน้า A4 สำหรับคนไข้ (TH/EN) แก้ไขได้ก่อนพิมพ์
src/pages/Admin.jsx                 อนุมัติแพทย์ใหม่, กำหนด role, จัดการ test catalog
src/lib/catalog.js                  จับคู่ชื่อการตรวจ, คำนวณ flag จากค่าอ้างอิง
```

## ติดตั้ง

1. สร้างโปรเจกต์ที่ supabase.com
2. SQL Editor > วางไฟล์ `supabase/schema.sql` ทั้งไฟล์ > Run
   แล้วรัน `supabase/migrations/002_test_catalog.sql` ต่อ (รันซ้ำได้ ไม่ทับค่าที่แก้ไว้)
3. Authentication > Providers > เปิด Email (แนะนำเปิด Confirm email)
4. Deploy Edge Function (ต้องมี Supabase CLI)
   ```
   supabase login
   supabase link --project-ref <project-ref>
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy ai-assist
   ```
5. Frontend
   ```
   cp .env.example .env      # ใส่ URL และ anon key จาก Project Settings > API
   npm install
   npm run dev
   ```
6. ลงทะเบียนบัญชีแรกผ่านหน้าเว็บ แล้วรันใน SQL Editor:
   ```sql
   update public.profiles set role = 'admin', is_active = true where email = 'you@clinic.com';
   ```
   หลังจากนี้แพทย์คนอื่นลงทะเบียนเองได้ และ admin อนุมัติในหน้า "จัดการแพทย์"
7. Deploy: Vercel หรือ Netlify (มี `vercel.json` และ `public/_redirects` สำหรับ SPA routing แล้ว)
   ใส่ env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_CLINIC_NAME`

## สิทธิ์ (RLS)

| บทบาท | เห็น | แก้ไข | แชร์/ลบคนไข้ |
|---|---|---|---|
| เจ้าของเคส (owner) | ✓ | ✓ | ✓ |
| แพทย์ที่ได้รับแชร์แบบ view | ✓ | | |
| แพทย์ที่ได้รับแชร์แบบ edit | ✓ | ✓ | |
| Admin | ทุกเคส | ทุกเคส | ทุกเคส |
| บัญชีที่ยังไม่อนุมัติ | | | |

- แพทย์เปลี่ยน role หรือ is_active ของตัวเองไม่ได้ (trigger `guard_profile_update`)
- ตารางลูก (findings, problems, plan_items, summaries) ดึง patient_id จาก visit อัตโนมัติ ป้องกันการเขียนข้ามคนไข้
- `save_visit` บันทึก visit และข้อมูลลูกทั้งหมดใน transaction เดียว และรันด้วยสิทธิ์ของแพทย์ที่เรียก
- `audit_log` เก็บการสร้าง/แก้/ลบ patients, visits, summaries (admin อ่านได้)

## เรื่อง PDPA และ AI

- API key อยู่ใน Edge Function เท่านั้น ไม่อยู่ในเบราว์เซอร์
- ข้อมูลที่ส่งให้ AI: โน้ตผลตรวจ + เพศ อายุ ประวัติพื้นฐาน (ไม่ส่งชื่อ/HN) แนะนำให้แพทย์ไม่พิมพ์ชื่อในโน้ต
- ร่างจาก AI เก็บไว้ใน `visits.ai_draft` เพื่อ audit ข้อมูลที่ใช้จริงคือสิ่งที่แพทย์ยืนยันในฟอร์ม
- ควรตรวจสอบนโยบายการประมวลผลข้อมูลสุขภาพขององค์กรก่อนใช้งานจริง

## Test catalog และแนวโน้ม

`test_catalog` คือรายการการตรวจมาตรฐานของคลินิก (seed ไว้ 87 รายการใน 4 หมวด) แต่ละรายการมี code, ชื่อมาตรฐาน,
ชื่อเรียกอื่น, หน่วย, ช่วงอ้างอิงแยกชาย/หญิง และ cutoff สำหรับ Borderline

- AI ได้รับรายชื่อมาตรฐานไปด้วย และหลัง AI ร่าง ระบบจับคู่ชื่อซ้ำอีกรอบ (เช่น "Vit D", "25(OH)D" > 25-OH vitamin D)
  แล้วเติมหน่วย หมวดย่อย และค่าอ้างอิงที่ว่างให้
- ช่องชื่อการตรวจมี autocomplete จาก catalog ของหมวดนั้น
- ถ้า flag ที่ AI หรือหมอใส่ไม่ตรงกับค่าอ้างอิง จะมีข้อความเตือนพร้อมปุ่ม "ใช้ค่านี้" ระบบไม่เปลี่ยนให้เอง
  (ยกเว้นแถวที่หมอพิมพ์เองและยังไม่ได้เลือก flag)
- ถ้าหน่วยไม่ตรงกับ catalog (เช่น HbA1c เป็น mmol/mol) ระบบจะไม่เช็ก flag และแจ้งเตือนแทน
- Sparkline จับคู่ข้ามครั้งตรวจด้วย `test_code` ผลที่ไม่อยู่ใน catalog จะจับคู่จากชื่อที่ normalize แล้ว
- Admin แก้ไข/เพิ่ม/ปิดใช้งานรายการได้ที่ ผู้ดูแลระบบ > Test catalog หมอทั่วไปอ่านได้อย่างเดียว

ค่าอ้างอิงใน seed เป็นค่าทั่วไปของผู้ใหญ่ ควรปรับให้ตรงกับแล็บที่ใช้จริงก่อนใช้งาน
โดยเฉพาะค่าที่ขึ้นกับอายุ (VO₂ max, DHEA-S, IGF-1, HRV) ซึ่งตั้งเป็นข้อความไว้และไม่คำนวณ flag
