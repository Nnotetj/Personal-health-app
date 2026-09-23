-- =====================================================================
-- Migration 003 — 5 หมวดใหม่: Clinical, Functional, Biomarker, Imaging, Multi-omics
-- + ช่อง Integrated Profile (เก็บใน visit_sections เหมือนหมวดอื่น)
-- รันใน SQL Editor ครั้งเดียว (รันซ้ำได้ ไม่พัง)
-- =====================================================================

do $$
begin
  -- 1) conventional -> biomarker  (ข้อมูลเก่าทุกตารางเปลี่ยนตามอัตโนมัติ)
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
             where t.typname = 'finding_category' and e.enumlabel = 'conventional') then
    alter type public.finding_category rename value 'conventional' to 'biomarker';
  end if;
end $$;

-- 2) หมวดใหม่
alter type public.finding_category add value if not exists 'clinical';
-- 3) ใช้กับ visit_sections เท่านั้น (ไม่แสดงในตัวเลือกหมวดของค่าตัวเลข/ปัญหา)
alter type public.finding_category add value if not exists 'integrated';

-- ตรวจผล: ควรได้ {biomarker,multiomic,functional,imaging,clinical,integrated}
select enum_range(null::public.finding_category);
