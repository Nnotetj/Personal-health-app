-- =====================================================================
-- Migration 002 — Standard test catalog
-- Run AFTER schema.sql. Safe to re-run.
--
-- Reference ranges below are common adult defaults (conventional units).
-- Every lab differs: review and edit them in the app (Admin > Test catalog).
-- Flag logic used by the app:
--   value < low_cutoff              -> low
--   low_cutoff <= value < ref_low   -> borderline
--   ref_low..ref_high               -> normal
--   ref_high < value < high_cutoff  -> borderline
--   value >= high_cutoff            -> high
--   (no cutoff set -> anything outside ref is low/high)
-- *_f columns override for female patients.
-- =====================================================================

create table if not exists public.test_catalog (
  code          text primary key,
  name          text not null unique,
  category      finding_category not null,
  subcategory   text,
  unit          text,
  ref_low       numeric,
  ref_high      numeric,
  ref_low_f     numeric,
  ref_high_f    numeric,
  low_cutoff    numeric,
  high_cutoff   numeric,
  ref_text      text,             -- shown when no numeric range (e.g. genotype, imaging)
  aliases       text[] not null default '{}',
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  updated_at    timestamptz not null default now()
);

alter table public.findings add column if not exists test_code text
  references public.test_catalog(code) on update cascade on delete set null;
create index if not exists idx_findings_code on public.findings(patient_id, test_code);

drop trigger if exists trg_touch_catalog on public.test_catalog;
create trigger trg_touch_catalog before update on public.test_catalog
  for each row execute function public.touch_updated_at();

alter table public.test_catalog enable row level security;
drop policy if exists catalog_select on public.test_catalog;
create policy catalog_select on public.test_catalog for select to authenticated
  using (public.is_active_user());
drop policy if exists catalog_write on public.test_catalog;
create policy catalog_write on public.test_catalog for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- save_visit now stores test_code --------------------------
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

  insert into findings (visit_id, category, subcategory, test_code, test_name, value_text, value_num, unit,
                        ref_range, flag, interpretation, sort_order)
  select v_id, x.category, x.subcategory,
         (select c.code from test_catalog c where c.code = x.test_code),   -- ignore unknown codes
         x.test_name, x.value_text, x.value_num, x.unit,
         x.ref_range, coalesce(x.flag, 'normal'), x.interpretation, coalesce(x.sort_order, 0)
  from jsonb_to_recordset(coalesce(p_findings, '[]')) as
       x(category finding_category, subcategory text, test_code text, test_name text, value_text text,
         value_num numeric, unit text, ref_range text, flag finding_flag, interpretation text, sort_order int)
  where coalesce(x.test_name, '') <> '';

  insert into plan_items (visit_id, problem_id, domain, action, target, timeframe, sort_order)
  select v_id, x.problem_id, coalesce(x.domain, 'other'), x.action, x.target, x.timeframe, coalesce(x.sort_order, 0)
  from jsonb_to_recordset(coalesce(p_plan, '[]')) as
       x(problem_id uuid, domain text, action text, target text, timeframe text, sort_order int)
  where coalesce(x.action, '') <> '';

  return v_id;
end $$;

-- ---------- Seed -----------------------------------------------------
insert into public.test_catalog
  (code, name, category, subcategory, unit, ref_low, ref_high, ref_low_f, ref_high_f, low_cutoff, high_cutoff, ref_text, aliases, sort_order)
values
-- CBC
('HGB','Hemoglobin','biomarker','CBC','g/dL',13.5,17.5,12,15.5,null,null,null,'{hb,hgb,haemoglobin}',10),
('HCT','Hematocrit','biomarker','CBC','%',41,53,36,46,null,null,null,'{hct}',11),
('WBC','WBC count','biomarker','CBC','x10³/µL',4,11,null,null,null,null,null,'{wbc,white blood cell}',12),
('PLT','Platelet count','biomarker','CBC','x10³/µL',150,400,null,null,null,null,null,'{plt,platelet,platelets}',13),
('MCV','MCV','biomarker','CBC','fL',80,100,null,null,null,null,null,'{mcv}',14),
('RDW','RDW','biomarker','CBC','%',11.5,14.5,null,null,null,null,null,'{rdw,rdw-cv}',15),
-- Glucose / insulin
('FBG','Fasting blood glucose','biomarker','Glucose / insulin','mg/dL',70,99,null,null,null,126,null,'{fbg,fbs,fpg,fasting glucose,glucose}',20),
('HBA1C','HbA1c','biomarker','Glucose / insulin','%',4,5.6,null,null,null,6.5,null,'{a1c,hba1c,glycated hemoglobin}',21),
('INSULIN','Fasting insulin','biomarker','Glucose / insulin','µIU/mL',2,10,null,null,null,20,null,'{insulin,fasting insulin}',22),
('HOMAIR','HOMA-IR','biomarker','Glucose / insulin',null,0,2.0,null,null,null,2.9,null,'{homa,homa-ir,homa ir}',23),
-- Lipid
('TC','Total cholesterol','biomarker','Lipid','mg/dL',0,199,null,null,null,240,null,'{tc,cholesterol,total chol,chol}',30),
('LDL','LDL-C','biomarker','Lipid','mg/dL',0,129,null,null,null,160,null,'{ldl,ldl-c,ldl cholesterol,direct ldl}',31),
('HDL','HDL-C','biomarker','Lipid','mg/dL',40,null,50,null,null,null,null,'{hdl,hdl-c,hdl cholesterol}',32),
('TG','Triglyceride','biomarker','Lipid','mg/dL',0,149,null,null,null,200,null,'{tg,triglycerides,trig}',33),
('NONHDL','Non-HDL cholesterol','biomarker','Lipid','mg/dL',0,159,null,null,null,190,null,'{non-hdl,non hdl,nonhdl}',34),
('APOB','Apolipoprotein B','biomarker','Lipid','mg/dL',0,99,null,null,null,130,null,'{apob,apo b,apolipoprotein b}',35),
('LPA','Lipoprotein(a)','biomarker','Lipid','mg/dL',0,29,null,null,null,50,null,'{lpa,lp(a),lp a,lipoprotein a}',36),
-- Liver
('AST','AST','biomarker','Liver','U/L',0,40,null,null,null,null,null,'{ast,sgot}',40),
('ALT','ALT','biomarker','Liver','U/L',0,40,null,null,null,null,null,'{alt,sgpt}',41),
('GGT','GGT','biomarker','Liver','U/L',0,60,0,40,null,null,null,'{ggt,gamma gt}',42),
('ALP','ALP','biomarker','Liver','U/L',40,129,null,null,null,null,null,'{alp,alkaline phosphatase}',43),
('TBIL','Total bilirubin','biomarker','Liver','mg/dL',0.3,1.2,null,null,null,null,null,'{tbil,total bilirubin,bilirubin}',44),
('ALB','Albumin','biomarker','Liver','g/dL',3.5,5.2,null,null,null,null,null,'{alb,albumin}',45),
-- Kidney
('BUN','BUN','biomarker','Kidney','mg/dL',7,20,null,null,null,null,null,'{bun,urea nitrogen}',50),
('CREA','Creatinine','biomarker','Kidney','mg/dL',0.7,1.3,0.5,1.1,null,null,null,'{cr,creatinine,crea,scr}',51),
('EGFR','eGFR','biomarker','Kidney','mL/min/1.73m²',90,null,null,null,60,null,null,'{egfr,gfr}',52),
('URIC','Uric acid','biomarker','Kidney','mg/dL',3.4,7.0,2.4,6.0,null,null,null,'{ua,uric acid,urate}',53),
('UACR','Urine albumin/creatinine ratio','biomarker','Urinalysis','mg/g',0,29,null,null,null,300,null,'{uacr,acr,microalbumin}',54),
-- Electrolytes
('NA','Sodium','biomarker','Electrolytes','mmol/L',135,145,null,null,null,null,null,'{na,sodium}',60),
('K','Potassium','biomarker','Electrolytes','mmol/L',3.5,5.1,null,null,null,null,null,'{k,potassium}',61),
('CL','Chloride','biomarker','Electrolytes','mmol/L',98,107,null,null,null,null,null,'{cl,chloride}',62),
('HCO3','Bicarbonate','biomarker','Electrolytes','mmol/L',22,29,null,null,null,null,null,'{hco3,co2,bicarbonate,tco2}',63),
('CA','Calcium','biomarker','Electrolytes','mg/dL',8.6,10.3,null,null,null,null,null,'{ca,calcium}',64),
-- Thyroid
('TSH','TSH','biomarker','Thyroid','mIU/L',0.4,4.0,null,null,null,null,null,'{tsh}',70),
('FT4','Free T4','biomarker','Thyroid','ng/dL',0.9,1.7,null,null,null,null,null,'{ft4,free t4}',71),
('FT3','Free T3','biomarker','Thyroid','pg/mL',2.0,4.4,null,null,null,null,null,'{ft3,free t3}',72),
('ATPO','Anti-TPO','biomarker','Thyroid','IU/mL',0,34,null,null,null,null,null,'{anti-tpo,tpo ab,anti tpo}',73),
-- Hormone
('TESTO','Total testosterone','biomarker','Hormone','ng/dL',264,916,8,60,null,null,null,'{testosterone,total testosterone,tt}',80),
('SHBG','SHBG','biomarker','Hormone','nmol/L',10,57,18,144,null,null,null,'{shbg}',81),
('E2','Estradiol','biomarker','Hormone','pg/mL',null,null,null,null,null,null,'Depends on cycle phase / menopause','{e2,estradiol}',82),
('DHEAS','DHEA-S','biomarker','Hormone','µg/dL',null,null,null,null,null,null,'Age & sex specific','{dhea-s,dheas,dhea s}',83),
('CORT','Cortisol (AM)','biomarker','Hormone','µg/dL',6.2,19.4,null,null,null,null,null,'{cortisol,am cortisol,morning cortisol}',84),
('IGF1','IGF-1','biomarker','Hormone','ng/mL',null,null,null,null,null,null,'Age specific','{igf-1,igf1}',85),
-- Vitamin / mineral
('VITD','25-OH vitamin D','biomarker','Vitamin / mineral','ng/mL',30,100,null,null,20,150,null,'{vit d,vitamin d,25-oh vitamin d,25ohd,25(oh)d,25-oh vit d}',90),
('B12','Vitamin B12','biomarker','Vitamin / mineral','pg/mL',300,900,null,null,200,null,null,'{b12,vit b12,cobalamin}',91),
('FOLATE','Folate','biomarker','Vitamin / mineral','ng/mL',4,null,null,null,3,null,null,'{folate,folic acid}',92),
('FERRITIN','Ferritin','biomarker','Vitamin / mineral','ng/mL',30,400,15,150,null,null,null,'{ferritin}',93),
('IRON','Serum iron','biomarker','Vitamin / mineral','µg/dL',60,170,null,null,null,null,null,'{iron,fe,serum iron}',94),
('MG','Magnesium','biomarker','Vitamin / mineral','mg/dL',1.7,2.4,null,null,null,null,null,'{mg,magnesium}',95),
('ZINC','Zinc','biomarker','Vitamin / mineral','µg/dL',60,120,null,null,null,null,null,'{zn,zinc}',96),
('O3I','Omega-3 index','biomarker','Vitamin / mineral','%',8,null,null,null,4,null,null,'{omega-3 index,omega 3 index,o3i}',97),
-- Inflammation
('HSCRP','hs-CRP','biomarker','Inflammation','mg/L',0,1.0,null,null,null,3.0,null,'{hscrp,hs-crp,crp,hs crp}',100),
('HCY','Homocysteine','biomarker','Inflammation','µmol/L',0,10,null,null,null,15,null,'{hcy,homocysteine}',101),
-- Tumor markers
('CEA','CEA','biomarker','Tumor marker','ng/mL',0,5,null,null,null,null,null,'{cea}',110),
('AFP','AFP','biomarker','Tumor marker','ng/mL',0,10,null,null,null,null,null,'{afp}',111),
('PSA','PSA','biomarker','Tumor marker','ng/mL',0,4,null,null,null,null,null,'{psa,total psa}',112),
('CA125','CA-125','biomarker','Tumor marker','U/mL',0,35,null,null,null,null,null,'{ca125,ca-125,ca 125}',113),
('CA199','CA 19-9','biomarker','Tumor marker','U/mL',0,37,null,null,null,null,null,'{ca19-9,ca 19-9,ca199}',114),
-- Multiomic
('APOE','APOE genotype','multiomic','Genetic',null,null,null,null,null,null,null,'e3/e3 reference','{apoe}',200),
('MTHFR','MTHFR genotype','multiomic','Genetic',null,null,null,null,null,null,null,'Wild type reference','{mthfr,mthfr c677t}',201),
('PRSCAD','Polygenic risk score (CAD)','multiomic','Genetic','percentile',null,80,null,null,null,95,null,'{prs,prs cad,polygenic risk}',202),
('BIOAGE','Epigenetic biological age','multiomic','Epigenetic','yr',null,null,null,null,null,null,'Compare with chronological age','{biological age,epigenetic age,bio age,dnam age}',210),
('DPACE','DunedinPACE','multiomic','Epigenetic',null,null,1.0,null,null,null,1.2,null,'{dunedinpace,pace of aging}',211),
('TELO','Telomere length','multiomic','Epigenetic',null,null,null,null,null,null,null,'Age percentile','{telomere,telomere length}',212),
('TMAO','TMAO','multiomic','Metabolomic','µM',0,6.2,null,null,null,10,null,'{tmao}',220),
('SHANNON','Gut microbiome diversity (Shannon)','multiomic','Microbiomic',null,null,null,null,null,null,null,'Lab specific','{shannon,microbiome diversity,alpha diversity,gut diversity}',230),
-- Functional
('BMI','BMI','functional','Body composition','kg/m²',18.5,22.9,null,null,null,25,null,'{bmi}',300),
('WAIST','Waist circumference','functional','Body composition','cm',null,89,null,79,null,null,null,'{waist,wc}',301),
('BF','Body fat','functional','Body composition','%',10,20,18,28,null,null,null,'{body fat,bf,pbf,fat percent}',302),
('SMM','Skeletal muscle mass','functional','Body composition','kg',null,null,null,null,null,null,'Compare to height & sex','{smm,skeletal muscle mass,muscle mass}',303),
('VFL','Visceral fat level','functional','Body composition',null,1,9,null,null,null,15,null,'{vfl,visceral fat,visceral fat level}',304),
('VO2MAX','VO₂ max','functional','VO₂ max','mL/kg/min',null,null,null,null,null,null,'Age & sex percentile','{vo2max,vo2 max,vo₂ max}',310),
('GRIP','Grip strength','functional','Grip strength','kg',28,null,18,null,null,null,null,'{grip,hand grip,handgrip}',311),
('SBP','Systolic BP','functional','Blood pressure','mmHg',90,119,null,null,null,130,null,'{sbp,systolic}',320),
('DBP','Diastolic BP','functional','Blood pressure','mmHg',60,79,null,null,null,80,null,'{dbp,diastolic}',321),
('RHR','Resting heart rate','functional','Blood pressure','bpm',50,80,null,null,null,100,null,'{rhr,resting hr,resting heart rate}',322),
('HRV','HRV (RMSSD)','functional','HRV','ms',null,null,null,null,null,null,'Age specific','{hrv,rmssd}',330),
('FEV1FVC','FEV1/FVC','functional','Spirometry','ratio',0.7,null,null,null,null,null,null,'{fev1/fvc,fev1 fvc}',340),
('CGMTIR','CGM time in range','functional','CGM','%',70,null,null,null,50,null,null,'{tir,time in range,cgm tir}',350),
-- Imaging
('CAC','CAC score','imaging','CAC score','Agatston',0,0,null,null,null,100,null,'{cac,calcium score,coronary calcium}',400),
('CIMT','Carotid IMT','imaging','Ultrasound','mm',null,0.9,null,null,null,null,null,'{cimt,carotid imt}',401),
('USABD','Ultrasound upper abdomen','imaging','Ultrasound',null,null,null,null,null,null,null,'Normal study','{us upper abdomen,us abdomen,ultrasound abdomen,uswa,us whole abdomen}',402),
('USTHY','Ultrasound thyroid','imaging','Ultrasound',null,null,null,null,null,null,null,'Normal study','{us thyroid,thyroid ultrasound}',403),
('MAMMO','Mammogram','imaging','Mammogram','BI-RADS',null,null,null,null,null,null,'BI-RADS 1–2','{mammogram,mammo,birads}',404),
('DEXAT','DEXA T-score (lowest)','imaging','DEXA',null,-1.0,null,null,null,-2.5,null,null,'{t-score,t score,dexa,bmd}',405),
('LVEF','LVEF','imaging','Echocardiogram','%',52,72,54,74,40,null,null,'{lvef,ef,ejection fraction}',406),
('CXR','Chest X-ray','imaging','X-ray',null,null,null,null,null,null,null,'Normal study','{cxr,chest x-ray,chest film}',407)
on conflict (code) do nothing;

-- Link existing findings to catalog by exact (case-insensitive) name or alias
update public.findings f set test_code = c.code
from public.test_catalog c
where f.test_code is null
  and (lower(f.test_name) = lower(c.name) or lower(f.test_name) = any (c.aliases));
