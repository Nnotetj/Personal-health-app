-- =====================================================================
-- Migration 009 — ลบเบอร์โทรและอีเมลของคนไข้ (data minimization / PDPA)
--
-- ไม่มีส่วนไหนของแอปใช้ 2 ช่องนี้ และตรวจแล้วไม่มีข้อมูล (0 จาก 36 คน)
-- รันหลัง deploy หน้าเว็บเวอร์ชันที่เอาช่องออกจากฟอร์มแล้ว
-- (ถ้ารันก่อน ฟอร์มเพิ่ม/แก้คนไข้เวอร์ชันเก่าจะบันทึกไม่ได้)
-- =====================================================================

-- กันพลาด: ถ้ามีคนกรอกข้อมูลไว้ระหว่างนี้ จะหยุดและไม่ลบอะไร
do $$
declare n int := 0;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'patients' and column_name = 'phone') then
    execute $q$ select count(*) from public.patients
                 where btrim(coalesce(phone, '')) <> '' or btrim(coalesce(email, '')) <> '' $q$ into n;
  end if;
  if n > 0 then
    raise exception 'มีคนไข้ % คนที่มีเบอร์โทรหรืออีเมล ตรวจสอบก่อนลบ', n;
  end if;
end $$;

alter table public.patients drop column if exists phone;
alter table public.patients drop column if exists email;

-- ตรวจผล: ต้องได้ 0 แถว
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'patients' and column_name in ('phone', 'email');
