-- =====================================================================
-- Migration 008 — ลบตารางเก่า problems / plan_items
--                 ให้ visit_sections เป็นที่เก็บปัญหาและแผนที่เดียว
--
-- ก่อนรัน:  1) backup ฐานข้อมูล   2) รัน 007 และตรวจว่าได้ 0 แถว
-- หลังรัน:  deploy หน้าเว็บเวอร์ชันใหม่ทันที (เวอร์ชันเก่าจะบันทึก visit ไม่ได้
--           เพราะยังส่ง p_problems / p_plan มา)
-- ถ้าข้อ 0 พบข้อมูลที่ยังไม่ย้าย สคริปต์จะหยุดและไม่เปลี่ยนอะไรเลย
-- =====================================================================

-- ---------- 0. กันพลาด: ต้องย้ายข้อมูลครบก่อน -------------------------
do $$
declare n int := 0;
begin
  if to_regclass('public.problems') is not null then
    execute $q$
      select count(*) from public.visits v
       where exists (select 1 from public.problems p where p.visit_id = v.id)
         and not exists (select 1 from public.visit_sections s
                          where s.visit_id = v.id and s.category = 'problem_list' and btrim(s.content) <> '')
    $q$ into n;
  end if;
  if n = 0 and to_regclass('public.plan_items') is not null then
    execute $q$
      select count(*) from public.visits v
       where exists (select 1 from public.plan_items x where x.visit_id = v.id)
         and not exists (select 1 from public.visit_sections s
                          where s.visit_id = v.id and s.category = 'plan_text' and btrim(s.content) <> '')
    $q$ into n;
  end if;
  if n > 0 then
    raise exception 'ยังมี % visit ที่ข้อมูลเก่ายังไม่ถูกย้าย ให้รัน 007 ก่อน', n;
  end if;
end $$;

-- ---------- 1. save_visit เวอร์ชันใหม่ (ไม่แตะตารางเก่า) ------------------
drop function if exists public.save_visit(jsonb, jsonb, jsonb, jsonb);
drop function if exists public.save_visit(jsonb, jsonb, jsonb, jsonb, jsonb);

-- security invoker: รันด้วยสิทธิ์ของแพทย์ที่เรียก RLS ทุกข้อจึงมีผล
create or replace function public.save_visit(p_visit jsonb, p_findings jsonb, p_sections jsonb default '[]')
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid := nullif(p_visit->>'id', '')::uuid;
begin
  if v_id is null then
    insert into visits (patient_id, visit_date, package_name, raw_note, ai_draft, doctor_note, status)
    values ((p_visit->>'patient_id')::uuid,
            coalesce(nullif(p_visit->>'visit_date', '')::date, current_date),
            p_visit->>'package_name', p_visit->>'raw_note', p_visit->'ai_draft',
            p_visit->>'doctor_note', coalesce(nullif(p_visit->>'status', '')::visit_status, 'draft'))
    returning id into v_id;
  else
    update visits set
      visit_date   = coalesce(nullif(p_visit->>'visit_date', '')::date, visit_date),
      package_name = p_visit->>'package_name',
      raw_note     = p_visit->>'raw_note',
      ai_draft     = coalesce(p_visit->'ai_draft', ai_draft),
      doctor_note  = p_visit->>'doctor_note',
      status       = coalesce(nullif(p_visit->>'status', '')::visit_status, status)
    where id = v_id;
    if not found then raise exception 'Visit not found or no edit permission'; end if;
    delete from findings       where visit_id = v_id;
    delete from visit_sections where visit_id = v_id;
  end if;

  -- ข้อความแต่ละหมวด รวมถึงรายการปัญหา (problem_list) และแผน (plan_text)
  insert into visit_sections (visit_id, category, content)
  select v_id, x.category, coalesce(x.content, '')
  from jsonb_to_recordset(coalesce(p_sections, '[]')) as x(category finding_category, content text)
  where coalesce(btrim(x.content), '') <> ''
  on conflict (visit_id, category) do update set content = excluded.content;

  insert into findings (visit_id, category, subcategory, test_code, test_name, value_text, value_num, unit,
                        ref_range, flag, interpretation, sort_order)
  select v_id, x.category, x.subcategory,
         (select c.code from test_catalog c where c.code = x.test_code),
         x.test_name, x.value_text, x.value_num, x.unit,
         x.ref_range, coalesce(x.flag, 'normal'), x.interpretation, coalesce(x.sort_order, 0)
  from jsonb_to_recordset(coalesce(p_findings, '[]')) as
       x(category finding_category, subcategory text, test_code text, test_name text, value_text text,
         value_num numeric, unit text, ref_range text, flag finding_flag, interpretation text, sort_order int)
  where coalesce(x.test_name, '') <> '';

  return v_id;
end $$;

revoke execute on function public.save_visit(jsonb, jsonb, jsonb) from public, anon;
grant  execute on function public.save_visit(jsonb, jsonb, jsonb) to authenticated;

-- ---------- 2. ให้ visit_sections มี trigger และ RLS ครบ เหมือนตารางลูกอื่น ----
drop trigger if exists trg_patient_from_visit on public.visit_sections;
create trigger trg_patient_from_visit before insert or update of visit_id on public.visit_sections
  for each row execute function public.set_patient_from_visit();

drop trigger if exists trg_touch_sections on public.visit_sections;
create trigger trg_touch_sections before update on public.visit_sections
  for each row execute function public.touch_updated_at();

alter table public.visit_sections enable row level security;
drop policy if exists visit_sections_select on public.visit_sections;
create policy visit_sections_select on public.visit_sections for select to authenticated
  using (public.can_view_patient(patient_id));
drop policy if exists visit_sections_insert on public.visit_sections;
create policy visit_sections_insert on public.visit_sections for insert to authenticated
  with check (public.can_edit_patient(patient_id));
drop policy if exists visit_sections_update on public.visit_sections;
create policy visit_sections_update on public.visit_sections for update to authenticated
  using (public.can_edit_patient(patient_id)) with check (public.can_edit_patient(patient_id));
drop policy if exists visit_sections_delete on public.visit_sections;
create policy visit_sections_delete on public.visit_sections for delete to authenticated
  using (public.can_edit_patient(patient_id));

-- ---------- 3. ลบตารางเก่า ---------------------------------------------
drop table if exists public.plan_items;
drop table if exists public.problems;

-- ---------- 4. ตรวจผล: ต้องไม่เหลือตารางเก่า และ save_visit มีเวอร์ชันเดียว ----
select to_regclass('public.problems')   as problems_should_be_null,
       to_regclass('public.plan_items') as plan_items_should_be_null,
       (select string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'save_visit') as save_visit_args;
