-- =====================================================================
-- Migration 004 — ปัญหาและแผนเป็นข้อความ (เก็บใน visit_sections)
-- รันทีละบรรทัด: วางบรรทัดที่ 1 -> Run -> ลบออก -> วางบรรทัดที่ 2 -> Run
-- =====================================================================
alter type finding_category add value if not exists 'problem_list';
alter type finding_category add value if not exists 'plan_text';
