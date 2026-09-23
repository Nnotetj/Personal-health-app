-- =====================================================================
-- Migration 003 — 5 หมวดใหม่: Clinical, Functional, Biomarker, Imaging, Multi-omics
-- + ช่อง Integrated Profile   (หา type เองอัตโนมัติ รันซ้ำได้)
-- =====================================================================
do $$
declare sch text;
begin
  select n.nspname into sch
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where t.typname = 'finding_category' limit 1;

  if sch is null then
    raise exception 'ไม่พบ finding_category ในฐานข้อมูลนี้ ตรวจว่าเปิด SQL Editor ถูกโปรเจกต์ (ดู project ref ใน URL)';
  end if;

  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
             join pg_namespace n on n.oid = t.typnamespace
             where t.typname = 'finding_category' and n.nspname = sch and e.enumlabel = 'conventional') then
    execute format('alter type %I.finding_category rename value %L to %L', sch, 'conventional', 'biomarker');
  end if;
  execute format('alter type %I.finding_category add value if not exists %L', sch, 'clinical');
  execute format('alter type %I.finding_category add value if not exists %L', sch, 'integrated');
end $$;

-- ตรวจผล
select n.nspname as schema, string_agg(e.enumlabel, ', ' order by e.enumsortorder) as values
from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid
where t.typname = 'finding_category' group by 1;
