-- =====================================================================
-- Personal Health Profile — Supabase schema
-- Run once in Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Enums ----------------------------------------------------
do $$ begin
  create type app_role         as enum ('doctor', 'admin');
  create type finding_category as enum ('conventional', 'multiomic', 'functional', 'imaging');
  create type finding_flag     as enum ('normal', 'low', 'high', 'borderline', 'abnormal', 'critical');
  create type access_level     as enum ('view', 'edit');
  create type priority_level   as enum ('high', 'medium', 'low');
  create type visit_status     as enum ('draft', 'final');
  create type summary_lang     as enum ('th', 'en');
exception when duplicate_object then null; end $$;

-- ---------- Tables ---------------------------------------------------

-- 1 row per doctor, linked to auth.users
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null default '',
  license_no  text,
  role        app_role not null default 'doctor',
  is_active   boolean  not null default false,   -- admin must approve new sign-ups
  created_at  timestamptz not null default now()
);

create table if not exists public.patients (
  id          uuid primary key default gen_random_uuid(),
  hn          text unique,
  first_name  text not null,
  last_name   text not null default '',
  sex         text check (sex in ('M', 'F', 'other')),
  dob         date,
  phone       text,
  email       text,
  background  text,           -- PMH, meds, allergies, family hx, lifestyle
  owner_id    uuid not null default auth.uid() references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Case sharing: owner/admin grants another doctor view or edit
create table if not exists public.patient_access (
  patient_id  uuid not null references public.patients(id) on delete cascade,
  doctor_id   uuid not null references public.profiles(id) on delete cascade,
  level       access_level not null default 'view',
  granted_by  uuid not null default auth.uid() references public.profiles(id),
  created_at  timestamptz not null default now(),
  primary key (patient_id, doctor_id)
);

-- 1 check-up episode (a full wellness package)
create table if not exists public.visits (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id) on delete cascade,
  visit_date    date not null default current_date,
  package_name  text,
  raw_note      text,         -- doctor's free-text pertinent findings
  ai_draft      jsonb,        -- untouched AI output, kept for audit
  doctor_note   text,         -- private clinical reasoning for the profile
  status        visit_status not null default 'draft',
  created_by    uuid not null default auth.uid() references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Each result line, grouped by the 4 categories
create table if not exists public.findings (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null references public.visits(id) on delete cascade,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  category        finding_category not null,
  subcategory     text,       -- e.g. CBC, Lipid, Genetic, Body composition, Ultrasound
  test_name       text not null,
  value_text      text,       -- as reported ("positive", "APOE e3/e4", "fatty liver gr 1")
  value_num       numeric,    -- numeric value for trends
  unit            text,
  ref_range       text,
  flag            finding_flag not null default 'normal',
  interpretation  text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

-- Prioritised problem list for a visit
create table if not exists public.problems (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references public.visits(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  title       text not null,
  detail      text,
  priority    priority_level not null default 'medium',
  category    finding_category,
  status      text not null default 'active' check (status in ('active', 'monitoring', 'resolved')),
  sort_order  int not null default 0
);

-- Plan of management, optionally linked to a problem
create table if not exists public.plan_items (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references public.visits(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  problem_id  uuid references public.problems(id) on delete set null,
  domain      text not null default 'other' check (domain in
               ('nutrition','exercise','sleep','stress','supplement','medication',
                'follow_up_test','referral','other')),
  action      text not null,
  target      text,
  timeframe   text,
  sort_order  int not null default 0
);

-- Patient-facing 1-page summary, one per visit per language
create table if not exists public.patient_summaries (
  id           uuid primary key default gen_random_uuid(),
  visit_id     uuid not null references public.visits(id) on delete cascade,
  patient_id   uuid not null references public.patients(id) on delete cascade,
  language     summary_lang not null,
  content      jsonb not null,   -- {headline, key_numbers[], priorities[], plan[], next_steps[]}
  ai_generated boolean not null default false,
  updated_by   uuid default auth.uid() references public.profiles(id),
  updated_at   timestamptz not null default now(),
  unique (visit_id, language)
);

-- Simple audit trail (PDPA)
create table if not exists public.audit_log (
  id          bigserial primary key,
  table_name  text not null,
  row_id      uuid,
  action      text not null,
  actor       uuid default auth.uid(),
  at          timestamptz not null default now()
);

-- ---------- Indexes --------------------------------------------------
create index if not exists idx_patients_owner   on public.patients(owner_id);
create index if not exists idx_access_doctor    on public.patient_access(doctor_id);
create index if not exists idx_visits_patient   on public.visits(patient_id, visit_date desc);
create index if not exists idx_findings_visit   on public.findings(visit_id);
create index if not exists idx_findings_trend   on public.findings(patient_id, test_name);
create index if not exists idx_problems_visit   on public.problems(visit_id);
create index if not exists idx_plan_visit       on public.plan_items(visit_id);

-- ---------- Helper functions (used by RLS) ---------------------------
-- security definer so policies can read profiles/access without recursion

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and is_active);
$$;

create or replace function public.is_owner_or_admin(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.is_active_user()
          and exists (select 1 from patients where id = pid and owner_id = auth.uid()));
$$;

create or replace function public.can_view_patient(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner_or_admin(pid)
      or (public.is_active_user()
          and exists (select 1 from patient_access where patient_id = pid and doctor_id = auth.uid()));
$$;

create or replace function public.can_edit_patient(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner_or_admin(pid)
      or (public.is_active_user()
          and exists (select 1 from patient_access
                      where patient_id = pid and doctor_id = auth.uid() and level = 'edit'));
$$;

-- ---------- Triggers -------------------------------------------------

-- Create profile on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, license_no)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', ''),
          new.raw_user_meta_data->>'license_no');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Only admins may change role / is_active
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and auth.uid() is not null        -- SQL editor / service role may bootstrap
     and not public.is_admin() then
    raise exception 'Only admin can change role or activation';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_profile on public.profiles;
create trigger trg_guard_profile before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Child rows always inherit patient_id from their visit (prevents cross-patient writes)
create or replace function public.set_patient_from_visit()
returns trigger language plpgsql as $$
begin
  select patient_id into new.patient_id from public.visits where id = new.visit_id;
  if new.patient_id is null then raise exception 'visit not found'; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['findings','problems','plan_items','patient_summaries'] loop
    execute format('drop trigger if exists trg_patient_from_visit on public.%I', t);
    execute format('create trigger trg_patient_from_visit before insert or update of visit_id on public.%I
                    for each row execute function public.set_patient_from_visit()', t);
  end loop;
end $$;

-- updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_touch_patients on public.patients;
create trigger trg_touch_patients before update on public.patients
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_touch_visits on public.visits;
create trigger trg_touch_visits before update on public.visits
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_touch_summaries on public.patient_summaries;
create trigger trg_touch_summaries before update on public.patient_summaries
  for each row execute function public.touch_updated_at();

-- Audit
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (table_name, row_id, action)
  values (tg_table_name, coalesce(new.id, old.id), tg_op);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['patients','visits','patient_summaries'] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I
                    for each row execute function public.write_audit()', t);
  end loop;
end $$;

-- ---------- Row Level Security --------------------------------------
alter table public.profiles          enable row level security;
alter table public.patients          enable row level security;
alter table public.patient_access    enable row level security;
alter table public.visits            enable row level security;
alter table public.findings          enable row level security;
alter table public.problems          enable row level security;
alter table public.plan_items        enable row level security;
alter table public.patient_summaries enable row level security;
alter table public.audit_log         enable row level security;

-- profiles: everyone logged in can see the doctor list (needed for sharing);
-- you edit yourself, admin edits anyone
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- patients
drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients for select to authenticated
  using (public.can_view_patient(id));
drop policy if exists patients_insert on public.patients;
create policy patients_insert on public.patients for insert to authenticated
  with check (public.is_active_user() and owner_id = auth.uid());
drop policy if exists patients_update on public.patients;
create policy patients_update on public.patients for update to authenticated
  using (public.can_edit_patient(id)) with check (public.can_edit_patient(id));
drop policy if exists patients_delete on public.patients;
create policy patients_delete on public.patients for delete to authenticated
  using (public.is_owner_or_admin(id));

-- patient_access: owner/admin manage; the shared doctor can see own grant
drop policy if exists access_select on public.patient_access;
create policy access_select on public.patient_access for select to authenticated
  using (doctor_id = auth.uid() or public.is_owner_or_admin(patient_id));
drop policy if exists access_write on public.patient_access;
create policy access_write on public.patient_access for all to authenticated
  using (public.is_owner_or_admin(patient_id))
  with check (public.is_owner_or_admin(patient_id));

-- Clinical tables: view if can_view, write if can_edit
do $$ declare t text; begin
  foreach t in array array['visits','findings','problems','plan_items','patient_summaries'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                    using (public.can_view_patient(patient_id))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                    with check (public.can_edit_patient(patient_id))', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                    using (public.can_edit_patient(patient_id))
                    with check (public.can_edit_patient(patient_id))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                    using (public.can_edit_patient(patient_id))', t);
  end loop;
end $$;

-- audit_log: admin read only (writes come from security-definer trigger)
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_admin());


-- ---------- Atomic save of one visit + all child rows ----------------
-- security invoker: runs as the calling doctor, so every RLS policy applies
create or replace function public.save_visit(p_visit jsonb, p_findings jsonb, p_problems jsonb, p_plan jsonb)
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
    delete from plan_items where visit_id = v_id;
    delete from problems   where visit_id = v_id;
    delete from findings   where visit_id = v_id;
  end if;

  insert into problems (id, visit_id, title, detail, priority, category, status, sort_order)
  select coalesce(x.id, gen_random_uuid()), v_id, x.title, x.detail,
         coalesce(x.priority, 'medium'), x.category, coalesce(x.status, 'active'), coalesce(x.sort_order, 0)
  from jsonb_to_recordset(coalesce(p_problems, '[]')) as
       x(id uuid, title text, detail text, priority priority_level, category finding_category, status text, sort_order int)
  where coalesce(x.title, '') <> '';

  insert into findings (visit_id, category, subcategory, test_name, value_text, value_num, unit,
                        ref_range, flag, interpretation, sort_order)
  select v_id, x.category, x.subcategory, x.test_name, x.value_text, x.value_num, x.unit,
         x.ref_range, coalesce(x.flag, 'normal'), x.interpretation, coalesce(x.sort_order, 0)
  from jsonb_to_recordset(coalesce(p_findings, '[]')) as
       x(category finding_category, subcategory text, test_name text, value_text text, value_num numeric,
         unit text, ref_range text, flag finding_flag, interpretation text, sort_order int)
  where coalesce(x.test_name, '') <> '';

  insert into plan_items (visit_id, problem_id, domain, action, target, timeframe, sort_order)
  select v_id, x.problem_id, coalesce(x.domain, 'other'), x.action, x.target, x.timeframe, coalesce(x.sort_order, 0)
  from jsonb_to_recordset(coalesce(p_plan, '[]')) as
       x(problem_id uuid, domain text, action text, target text, timeframe text, sort_order int)
  where coalesce(x.action, '') <> '';

  return v_id;
end $$;

grant execute on function public.save_visit(jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ---------- Bootstrap first admin -----------------------------------
-- After you sign up the first account in the app, run:
-- update public.profiles set role = 'admin', is_active = true where email = 'you@clinic.com';
-- (Run in SQL Editor — it bypasses the guard because it runs as postgres.)
