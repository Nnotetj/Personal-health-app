-- =====================================================================
-- Migration 006 — เอกสาร Personal Health Profile หลายภาษา (English / ไทย) + ภาษาเริ่มต้นของคนไข้
-- รันทีละบรรทัด: วางบรรทัดที่ 1 -> Run -> ลบออก -> วางบรรทัดถัดไป -> Run  (รันซ้ำได้)
-- =====================================================================
alter type summary_lang add value if not exists 'sheet_en';
alter type summary_lang add value if not exists 'sheet_th';
alter table public.patients add column if not exists doc_lang text not null default 'bi' check (doc_lang in ('bi', 'en', 'th'));
