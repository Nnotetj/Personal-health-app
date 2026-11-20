-- =====================================================================
-- Migration 007 — ย้ายปัญหา/แผนจากตารางเก่า (problems, plan_items)
--                 เข้า visit_sections ให้หมด ก่อนลบตารางเก่าใน 008
--
-- * รันซ้ำได้: เติมเฉพาะ visit ที่ visit_sections ยังว่างในหมวดนั้น
--   ไม่ทับข้อความที่แพทย์พิมพ์ไว้แล้ว
-- * รูปแบบข้อความตรงกับที่หน้าเว็บเคยแปลงให้ (problemsToText / planToText)
-- * ยังไม่ลบอะไร ตรวจผลท้ายไฟล์ให้ถูกต้องก่อนไปรัน 008
-- =====================================================================

-- ---------- 0. บันทึกโครงสร้าง visit_sections ไว้ใน repo ----------------
-- ตารางนี้มีอยู่แล้วในฐานข้อมูลจริง คำสั่งนี้จะไม่ทำอะไรกับตารางเดิม
-- มีไว้ให้คนที่ติดตั้งโปรเจกต์ใหม่ได้ตารางเดียวกัน
create table if not exists public.visit_sections (
  visit_id    uuid not null references public.visits(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  category    finding_category not null,
  content     text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (visit_id, category)
);

-- ---------- 1. แปลงข้อมูลเก่าเป็นข้อความ -------------------------------
drop table if exists _legacy_text;
create temp table _legacy_text (visit_id uuid, category finding_category, content text);

-- ข้ามได้เลยถ้าไม่มีตารางเก่า (เช่น ติดตั้งใหม่ หรือรัน 008 ไปแล้ว)
do $mig$
begin
  if to_regclass('public.problems') is null or to_regclass('public.plan_items') is null then
    raise notice 'ไม่พบตาราง problems/plan_items ข้ามการย้ายข้อมูล';
    return;
  end if;
  execute $q$
insert into _legacy_text (visit_id, category, content)
with pr as (
  select p.*,
         row_number() over (partition by p.visit_id order by p.priority, p.sort_order, p.id) as n
  from public.problems p
),
pl as (
  select x.*, pr.n,
         '- ' || case x.domain
                   when 'nutrition'      then 'Nutrition'
                   when 'exercise'       then 'Exercise'
                   when 'sleep'          then 'Sleep'
                   when 'stress'         then 'Stress'
                   when 'supplement'     then 'Supplement'
                   when 'medication'     then 'Medication'
                   when 'follow_up_test' then 'Follow-up test'
                   when 'referral'       then 'Referral'
                   else 'Other' end
         || ': ' || x.action
         || coalesce(' | Target: ' || nullif(x.target, ''), '')
         || coalesce(' | ' || nullif(x.timeframe, ''), '') as line
  from public.plan_items x
  left join pr on pr.id = x.problem_id and pr.visit_id = x.visit_id
),
problem_text as (
  select visit_id,
         string_agg(n || '. ' || title
                    || ' (' || initcap(priority::text) || ')'
                    || coalesce(' — ' || nullif(detail, ''), ''),
                    E'\n' order by n) as content
  from pr group by visit_id
),
plan_blocks as (
  -- 1 บล็อกต่อ 1 ปัญหา (เลขเดียวกับรายการปัญหา) + บล็อก General ท้ายสุด
  select pl.visit_id,
         coalesce(pl.n, 2147483647) as ord,
         coalesce(pl.n || '. ' || max(pr.title), 'General')
           || E'\n' || string_agg(pl.line, E'\n' order by pl.sort_order, pl.id) as block
  from pl left join pr on pr.id = pl.problem_id and pr.visit_id = pl.visit_id
  group by pl.visit_id, pl.n
),
plan_text as (
  select visit_id, string_agg(block, E'\n\n' order by ord) as content
  from plan_blocks group by visit_id
)
select visit_id, 'problem_list'::finding_category as category, content from problem_text
union all
select visit_id, 'plan_text'::finding_category, content from plan_text
  $q$;
end $mig$;

-- ---------- 2. เติมลง visit_sections (เฉพาะช่องที่ยังว่าง) ---------------
update public.visit_sections s
   set content = l.content, updated_at = now()
  from _legacy_text l
 where s.visit_id = l.visit_id and s.category = l.category
   and coalesce(trim(s.content), '') = '';

insert into public.visit_sections (visit_id, patient_id, category, content, updated_at)
select l.visit_id, v.patient_id, l.category, l.content, now()
  from _legacy_text l
  join public.visits v on v.id = l.visit_id
 where not exists (select 1 from public.visit_sections s
                    where s.visit_id = l.visit_id and s.category = l.category);

-- ---------- 3. ตรวจผล ----------------------------------------------------
-- ต้องได้ 0 แถว: visit ที่มีข้อมูลในตารางเก่า แต่ visit_sections ยังว่าง
drop table if exists _missing;
create temp table _missing (visit_id uuid, visit_date date, missing text);
do $chk$
begin
  if to_regclass('public.problems') is null or to_regclass('public.plan_items') is null then return; end if;
  execute $q$
    insert into _missing
    select v.id, v.visit_date, 'problem_list'
      from public.visits v
     where exists (select 1 from public.problems p where p.visit_id = v.id)
       and not exists (select 1 from public.visit_sections s
                        where s.visit_id = v.id and s.category = 'problem_list' and btrim(s.content) <> '')
    union all
    select v.id, v.visit_date, 'plan_text'
      from public.visits v
     where exists (select 1 from public.plan_items x where x.visit_id = v.id)
       and not exists (select 1 from public.visit_sections s
                        where s.visit_id = v.id and s.category = 'plan_text' and btrim(s.content) <> '')
  $q$;
end $chk$;
select * from _missing;
