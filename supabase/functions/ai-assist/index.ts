// Supabase Edge Function: ai-assist  (ฉบับแก้: ใช้ tool use บังคับรูปแบบ JSON)
// Deploy:  supabase functions deploy ai-assist
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// mode "extract": free-text findings  -> { findings[], problems[], plan[] }
// mode "summary": structured profile  -> patient-friendly 1-page content (th | en)
// mode "translate": saved English summary -> plain-language Thai (same structure)
// mode "sheet": doctor-approved profile -> Personal Health Profile sheet (language: bi = TH + EN terms | en | th)

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 8000;
const DEADLINE_MS = 140_000;  // Supabase ตัดที่ ~150 วินาที เผื่อไว้ 10 วินาที

const EXTRACT_SYSTEM = `You are a clinical assistant for a preventive / longevity medicine clinic.
The doctor pastes a shorthand check-up note. Turn it into a one-page Personalized Health Profile draft
FOR THE DOCTOR, organised MECE into FIVE sections plus an integrated profile. The doctor will edit it.

Language: concise clinical English (abbreviations the doctor would accept are fine). Brand names ->
generic names with dose (Zoloft 50 mg -> sertraline 50 mg, Nexium -> esomeprazole, Cavstat -> rosuvastatin).

MECE rules
- Mutually exclusive: every finding appears in exactly ONE place. Do not repeat a finding in another
  section, in the สรุป line of another section, or as a separate line.
- Collectively exhaustive: every clinically meaningful item in the note has a place. Never drop one.
- Never invent tests, values or diagnoses. Keep numbers exactly as written. When a value or history is
  uncertain in the note (e.g. "?"), write "reported" / "possible". Label hypothesis-level findings as such.
- TOTAL length of all sections + integrated must be at most 500 words.

Sections (arrays of strings; empty array if no data)
1. "clinical": U/D and allergy; PHx incl. prior procedures and their reported results; current medication
   and supplements; lifestyle / exposure (smoking, alcohol, stress); main concerns; family history.
2. "functional": body composition (BMI, fat, visceral fat, FMI, lean mass), physical fitness and strength
   (fitness age, grip, gait speed, VO2max, FEV1), REE / calorie data, functional capacity, bone status.
3. "biomarker": conventional labs and advanced NON-omics biomarkers: cardiometabolic, inflammation, TMAO,
   fatty-acid profile, micronutrient / oxidative panels, endocrine, food reactivity / FODMAP,
   ctDNA, p-tau217 / AD markers, NAD, immune (CD4/CD8), telomere age.
4. "imaging": vascular (CIMT, plaque, arterial stiffness, CAC, echo, EKG findings such as sinus bradycardia),
   brain, thyroid, liver, LDCT / abdominal ultrasound and other scans.
5. "multiomic": ONLY these molecular layers, one item per layer, each starting with the layer name:
   "Genome / Genetics: ..." (SNP, pathogenic variant, carrier screening, PRS, pharmaco- & nutrigenomics,
   sport / trait genetics), "Epigenome: ..." (methylation, biological age, pace of aging, organ ages,
   epigenetic alcohol / smoking signals), "Transcriptome: ...", "Proteome: ...",
   "Metabolome: ..." (organic acids / OAT, broad metabolite profiling), "Microbiome: ..." (stool sequencing).
   Put layers with no data together in ONE item, e.g. "Microbiome / Transcriptome / Proteome: No direct data available."
   Note: dysbiosis MARKERS from urine organic acids belong to Metabolome, not Microbiome.

Line style
- Each item starts with a short sub-topic label and a colon, e.g. "Body composition: ...", "Vascular: ...".
- Group related results on one line. Add a brief read after "→" when helpful
  (e.g. "... relatively low lean mass → high adiposity with low muscle reserve").
- Do NOT put newline characters inside any string. Do not start items with "- "; the app adds the bullet.
- The LAST item of each non-empty section must start with "สรุป: " followed by ONE short English sentence
  (under 20 words) giving the clinical read of that section without repeating its numbers.

"integrated": ONE string, 2-4 sentences: main priorities in order, and any key caveat
(e.g. favourable CAC or biological age must not outweigh established plaque or infarct).

"key_values": up to 12 NUMERIC results worth tracking over time. Numbers only. category must be one of
clinical, functional, biomarker, imaging, multiomic.
"problem_list" (inside sections): 2 to 6 items ranked by importance for proactive prevention. Each item is ONE line:
  "<n>. <problem title> (High|Medium|Low) — <1-2 sentence detail with the supporting findings and why it matters>"
  e.g. "1. Iron-deficiency anemia secondary to menorrhagia (High) — Hb 10.5 g/dL, MCV 74, ferritin 8 ng/mL with 7-day heavy menses."
"plan_groups" (inside sections): the plan of management, grouped by problem. 3 to 10 actions in total.
  Each group: "problem" = the problem number from problem_list (1, 2, 3...), or 0 for general plans
  not tied to one problem; "items" = actions, ONE line each:
  "<Domain>: <action> | Target: <target> | <timeframe>"
  Domain is a plain word such as Nutrition, Exercise, Sleep, Stress, Supplement, Medication,
  Follow-up test, Referral, Lifestyle. Do NOT write the problem title; the app adds it.
  e.g. {"problem": 1, "items": ["Supplement: Start oral iron (ferrous fumarate) | Target: ferritin >30 ng/mL | Recheck CBC and ferritin in 8-12 weeks"]}
problem_list and plan_groups do not count toward the 500-word limit and have no "สรุป:" line.

FORMAT EXAMPLE (style only; never copy these findings into another patient)
Note (excerpt):
u/d = DLP, GERD, depress, hair | allergy: deny | alc 2+/smk heavy 20 cigs/d
current med = Zoloft 50 mg, Nexium, Cavstat (Rosuvastatin 10 mg), valium prn, Finasteride, Minoxidil
BODY; ovwt 26, visc fat = 2+, BF 32%, fmi = 8, ratio > 1 | lo LMI
CVD: DLP; L 119, H 48, sd 23 | cimt = 0.9, plaque | sb 48, a.stf, est, echo = nl, cac = 0
BRAIN: Old lacunar infarction at left basal ganglia | now no neurological sign, deny CVA
pace of aging: CA = 49.8, Bio age = 43.3, pace = 0.8, Lung 53, MSK 51.4, risk: alc = mod, smk = nl
Output (excerpt):
clinical:
  "U/D: Dyslipidemia, MDD with anxiety, GERD, alopecia; no known allergy."
  "Current medication: Rosuvastatin 10 mg, sertraline 50 mg, esomeprazole, diazepam PRN, finasteride, minoxidil."
  "Lifestyle: Heavy smoker ~20 cigarettes/day, alcohol use, stress 8/10."
  "สรุป: Treated dyslipidemia and mood disorder with major modifiable smoking risk."
functional:
  "Body composition: BMI ~26, body fat ~32%, increased visceral fat, FMI ~8, fat distribution ratio >1, relatively low lean mass → high adiposity with low muscle reserve."
imaging:
  "Vascular: CIMT ~0.9 mm, carotid plaque, arterial stiffness; CAC = 0; echocardiogram normal; sinus bradycardia ~48 bpm."
  "Brain: Old lacunar infarction at left basal ganglia; no current neurological deficit or known prior CVA."
multiomic:
  "Epigenome: Chronological age 49.8 yr vs biological age 43.3 yr; pace of aging 0.8. Lung age 53 yr and MSK age 51.4 yr are less favorable. Epigenetic alcohol signal moderate; smoking signal reportedly normal despite active heavy smoking."
  "Microbiome / Transcriptome / Proteome: No direct data available."
integrated:
  "Major priorities are vascular risk reduction, smoking cessation, body recomposition/muscle preservation, fatty liver/GI management, stress optimization and thyroid follow-up. Favorable CAC and biological-age metrics should not outweigh established carotid plaque and old lacunar infarction."

Return the result by calling the submit_result tool.`;

const summarySystem = (lang: "th" | "en") => `You write "My Personalized Health Profile": a one-page health summary FOR THE PATIENT, not the doctor.
Language: ${lang === "th"
  ? "Thai, everyday spoken-style language a non-medical adult understands. Avoid medical jargon and English abbreviations; if a medical word is unavoidable, explain it in plain Thai (e.g. 'หลอดเลือดสมองตีบขนาดเล็กแบบไม่มีอาการ')."
  : "plain, warm English a non-medical adult understands. Avoid medical jargon and abbreviations; explain unavoidable terms simply (e.g. a small old 'silent stroke')."}

Source: the doctor-approved profile provided. Never add diagnoses, numbers, tests or treatments that are not in it.
The profile's sections.problem_list is the ranked problem list and sections.plan_text is the doctor's plan
(grouped under "<n>. <problem title>" headings, with a "General" group for plans not tied to one problem). Build each theme's "plan" from these plan lines,
rewritten in everyday language, and put follow-up tests and referrals in "follow_up". Every plan line must
appear somewhere; never leave a theme's plan empty when the doctor wrote a plan for it.

Length: the WHOLE text must be at most 450 words (Thai: similar length) so it fits one A4 page. Word budget:
intro ≤ 45 words; each theme body ≤ 55 words in total (1-2 short paragraphs); each plan item ≤ 12 words and at most 3 items per theme; each follow-up item ≤ 10 words;
each goal ≤ 15 words; follow_up ≤ 25 words; closing ≤ 20 words. Cut repetition and background detail first.
Use only a few meaningful numbers (e.g. body fat about 32%, stress 8/10, biological age about 43 vs actual
age about 50); skip lab units and reference ranges.

MECE structure
- Group everything into 4 to 5 themes (never more than 5; merge minor items) by what matters to the patient's life, e.g. heart, brain & blood vessels;
  weight, muscle & metabolism; nutrition, gut & energy; stress, mood & recovery; healthy aging & genetics.
- Mutually exclusive: each finding appears in ONE theme only; do not repeat it in another theme.
- Collectively exhaustive: every important finding or concern in the profile has a place. Items that only
  need monitoring go in "follow_up".
- Order themes by importance. Add " — Highest Priority" to the first theme title when it is clearly the most important.

Content
- "intro": 2-3 sentences. Start with the reassuring findings, then name the main focus areas.
- Each theme: "title"; "body" = 1 to 2 short paragraphs (what was found, what it means, reassuring points,
  what raises the risk); "plan" = 1 to 3 items, each {"action": what to do in everyday words (≤ 12 words),
  "when": short timing such as "ภายใน 4 สัปดาห์" / "within 4 weeks" / "3–6 months" / "ongoing"}.
  Use an empty list when the theme is information only (e.g. genetics). Referrals and treatment steps stay
  in the theme's plan. Genetic results show risk, not certainty — say so.
- "goals": exactly 3 items with labels ${lang === "th" ? '"อันดับแรก", "อันดับสอง", "อันดับสาม"' : '"First", "Second", "Third"'}, one short action-focused sentence each.
- "follow_up": the repeat tests / re-checks only, as items {"what": plain-language test (≤ 10 words), "when": timing},
  sorted from soonest to latest. Do NOT repeat actions already listed in a theme's plan.
- "closing": one encouraging sentence.
- Be honest and encouraging, never alarming. No bullet characters inside strings.

STYLE EXAMPLE (English, excerpt; never copy these findings into another patient)
intro: "Your health check shows a mix of good protective factors and a few important areas that need attention. The good news is that your heart pumping function is normal, your coronary calcium score is 0, your omega-3 level is good, and your biological age is younger than your actual age. However, your blood vessels, body composition, liver, lifestyle and stress level should become the main focus of your health plan."
theme: title "Heart, Brain & Blood Vessel Health — Highest Priority"
  body ["You have high cholesterol, early plaque in the neck arteries, and a small old 'silent stroke' seen on brain imaging, even though you have never had obvious stroke symptoms. Your heart ultrasound is normal and no calcium buildup was found in the coronary arteries, which is reassuring.", "However, because you smoke about 20 cigarettes per day, your overall blood vessel risk is still significant."]
  plan [{"action": "Continue cholesterol treatment", "when": "ongoing"}, {"action": "Stop smoking with support from the clinic", "when": "start now"}, {"action": "See a heart specialist about the neck artery plaque", "when": "within 3 months"}]
theme: title "Healthy Aging & Genetics"
  body ["Your biological age is about 43 years compared with an actual age of about 50, which is encouraging. However, your lung and musculoskeletal aging scores are less favorable.", "Genetic testing suggests higher susceptibility to some cardiovascular, metabolic, neurological and cancer-related conditions, but these results show risk, not certainty."]
  plan []
goals: First "Protect your heart and brain by stopping smoking and controlling cholesterol." / Second "Reduce abdominal fat and build muscle." / Third "Improve liver, gut, nutrition, stress and sleep."
follow_up: [{"what": "Repeat cholesterol blood test", "when": "3 months"}, {"what": "Thyroid ultrasound", "when": "6 months"}, {"what": "Repeat neck artery scan", "when": "12 months"}]
closing: "Your strongest opportunity is to turn good biological-aging potential into better long-term health by improving the modifiable risks that matter most."

Return the result by calling the submit_result tool.`;

const TRANSLATE_SYSTEM = `You turn a doctor-approved English patient health summary into Thai for a patient who is NOT medically trained.

Rules
- Everyday, polite spoken-style Thai (ภาษาไทยที่เข้าใจง่าย สุภาพ). Do not translate word by word; rewrite so it reads naturally.
- Keep the MAIN IDEA of every part exactly. Do not add, remove, merge or reorder themes, goals or findings.
  Keep the same number of themes, body paragraphs and goals, in the same order.
- Keep important numbers (e.g. วิตามินดี 24, T-score -2.1, ไขมันในร่างกาย 32%) but drop units and reference ranges
  unless they help understanding.
- Replace medical terms and English abbreviations with plain Thai explanations, e.g.
  "Subclinical hypothyroidism" -> "ไทรอยด์เริ่มทำงานช้าลงเล็กน้อย"; "Osteopenia" -> "มวลกระดูกเริ่มบาง";
  "anti-TPO" -> "ภูมิคุ้มกันที่มีต่อต่อมไทรอยด์". Keep an English term in parentheses only when the patient
  may hear it from other doctors.
- Drop priority labels such as "(High)"/"(Medium)" from titles; the order already shows importance.
  Keep a phrase like "— สำคัญที่สุด" only if the English title has "Highest Priority".
- Be SHORTER than the English: each body paragraph 1-2 short sentences; each plan one short sentence.
- Keep the same number of plan items and follow-up items, in the same order; translate "when" into short Thai
  (e.g. "within 4 weeks" -> "ภายใน 4 สัปดาห์", "ongoing" -> "ทำต่อเนื่อง").
- Goal labels must be "อันดับแรก", "อันดับสอง", "อันดับสาม" in the same order.
- Warm and encouraging, never alarming. Empty fields stay empty.

Return the result by calling the submit_result tool.`;

const WORD_LIMIT = 500;

// นับคำ (รองรับภาษาไทยที่ไม่มีช่องว่าง) — ใช้วิธีเดียวกับหน้าเว็บ
function countWords(c: any): number {
  const list = (v: any, a: string, b: string) => (Array.isArray(v) ? v.flatMap((x: any) => [x?.[a], x?.[b]]) : [v]);
  const text = [c?.intro, ...(c?.themes ?? []).flatMap((x: any) => [x.title, ...(x.body ?? []), ...list(x.plan, "action", "when")]),
    ...(c?.goals ?? []).map((g: any) => g.text), ...list(c?.follow_up, "what", "when"), c?.closing].filter(Boolean).join(" ");
  let n = 0;
  for (const seg of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) if (seg.isWordLike) n++;
  return n;
}

const SHORTEN_SYSTEM = `You shorten a patient health summary so it fits one A4 page.
Target: at most 430 words in total (Thai: similar length). Keep the same language, the same themes in the same
order, the same goals, and every main idea. Keep plan and follow-up items as short list items (you may drop the
least important plan item if a theme has 3). Remove repetition, background detail and extra examples;
make sentences shorter. Do not add anything new.
Return the result by calling the submit_result tool.`;

// ถ้ายาวเกิน ให้ AI ย่ออีก 1 รอบ
async function withinLimit(content: any, deadline: number) {
  const n = countWords(content);
  if (n <= WORD_LIMIT) return content;
  console.error(`Summary ${n} words, shortening`);
  try {
    return await callClaude(SHORTEN_SYSTEM, `Summary (${n} words, JSON):\n${JSON.stringify(content)}`, SUMMARY_SCHEMA, deadline);
  } catch (e) {
    console.error("Shorten failed, returning long version", String((e as Error).message));
    return content;
  }
}

// ---------- รูปแบบข้อมูลที่บังคับให้ AI ส่งกลับ ----------
const str = { type: "string" };
const strArr = { type: "array", items: str };

// หมวดที่ตรงกับ enum finding_category ในฐานข้อมูล (ถ้าในฐานข้อมูลมีชื่ออื่น แก้ตรงนี้ที่เดียว)
const CATEGORIES = ["clinical", "functional", "biomarker", "imaging", "multiomic"];
const cat = { type: "string", enum: CATEGORIES };

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "object",
      properties: {
        clinical: strArr, functional: strArr, biomarker: strArr, imaging: strArr, multiomic: strArr,
        integrated: str, problem_list: strArr,
        plan_groups: {
          type: "array",
          items: {
            type: "object",
            properties: { problem: { type: "integer" }, items: strArr },
            required: ["problem", "items"],
          },
        },
      },
      required: ["clinical", "functional", "biomarker", "imaging", "multiomic", "integrated", "problem_list", "plan_groups"],
    },
    key_values: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: cat, test_name: str, value_num: { type: "number" }, unit: str, ref_range: str,
          flag: { type: "string", enum: ["normal", "low", "high", "borderline", "abnormal", "critical"] },
        },
        required: ["category", "test_name", "value_num", "flag"],
      },
    },
  },
  required: ["sections", "key_values"],
};

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    intro: str,
    themes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: str, body: strArr,
          plan: { type: "array", items: { type: "object", properties: { action: str, when: str }, required: ["action", "when"] } },
        },
        required: ["title", "body", "plan"],
      },
    },
    goals: {
      type: "array",
      items: { type: "object", properties: { label: str, text: str }, required: ["label", "text"] },
    },
    follow_up: { type: "array", items: { type: "object", properties: { what: str, when: str }, required: ["what", "when"] } },
    closing: str,
  },
  required: ["intro", "themes", "goals", "follow_up", "closing"],
};


type SheetLang = "bi" | "en" | "th";

const sheetSystem = (lang: SheetLang) => {
  const style = {
    bi: `Language style (follow exactly)
- Thai first, written naturally and politely. KEEP English for drug names, test names, abbreviations, diagnoses and numbers
  (e.g. "Carotid plaque, CAC 4, LDL 181, ApoB 137"). Do not translate drug brand/generic names.`,
    th: `Language style (follow exactly)
- Everything in natural, polite Thai. KEEP English only for drug names, test names, abbreviations and numbers
  (e.g. "Carotid plaque, CAC 4, LDL 181"). "title_en" stays the exact English title from the profile; "title_th" is its Thai translation.`,
    en: `Language style (follow exactly)
- Everything in clear, professional English for an international patient and their doctors. No Thai characters anywhere.
  Keep drug names, test names and numbers as they are. Leave "title_th" as an empty string.`,
  }[lang];
  const fields = {
    bi: `- "allergy": drug allergy in Thai ("ปฏิเสธ" for none, or the allergen). "" if not stated.
- "family_history": Thai with English terms in parentheses when helpful, e.g. "โรคหลอดเลือดสมอง (stroke); มะเร็งเต้านมในอายุน้อย (early breast cancer)".
- "medications": "use" = dose and indication in Thai (e.g. "12.5 mg · ภาวะก่อนเบาหวาน / ควบคุมน้ำหนัก"); "status" in Thai (e.g. "ใช้อยู่", "ใช้ไม่สม่ำเสมอ", "เริ่มแล้ว", "เริ่มใหม่ตามแผน").
- "problems": "title_th" = Thai translation; "evidence" = Thai supporting data with key numbers and why it matters, 1-3 short clauses.
- "plan" items "type" must be one of: ยา, อาหารเสริม, โภชนาการ, วิถีชีวิต, ตรวจติดตาม, ส่งต่อ, อื่น ๆ. Other item fields in Thai (English terms kept).
  "follow_up" e.g. "ตรวจ lipid panel ซ้ำใน 8–12 สัปดาห์", "ต่อเนื่อง".`,
    th: `- "allergy": drug allergy in Thai ("ปฏิเสธ" for none, or the allergen). "" if not stated.
- "family_history": Thai.
- "medications": "use" = dose and indication in Thai; "status" in Thai (e.g. "ใช้อยู่", "ใช้ไม่สม่ำเสมอ", "เริ่มแล้ว", "เริ่มใหม่ตามแผน").
- "problems": "title_th" = Thai translation; "evidence" = Thai supporting data with key numbers, 1-3 short clauses.
- "plan" items "type" must be one of: ยา, อาหารเสริม, โภชนาการ, วิถีชีวิต, ตรวจติดตาม, ส่งต่อ, อื่น ๆ. Other item fields in Thai.`,
    en: `- "allergy": drug allergy ("None reported" if the profile says none, or the allergen). "" if not stated.
- "family_history": English.
- "medications": "use" = dose and indication in English; "status" in English (e.g. "Taking", "Taking irregularly", "Started", "Newly started per plan").
- "problems": "title_en" = exact English title; "title_th" = ""; "evidence" = English supporting data with key numbers, 1-3 short clauses.
- "plan" items "type" must be one of: Medication, Supplement, Nutrition, Lifestyle, Follow-up test, Referral, Other. Other item fields in English.
  "follow_up" e.g. "Repeat lipid panel in 8–12 weeks", "Ongoing".`,
  }[lang];
  const periods = lang === "en"
    ? ["Within 1 month", "4–6 weeks", "3 months", "6 months", "Yearly", "Every 2–3 years"]
    : ["ภายใน 1 เดือน", "4–6 สัปดาห์", "3 เดือน", "6 เดือน", "ทุกปี", "2–3 ปี"];
  return `You fill in a "Personal Health Profile" form (Problem List and Plan of Management) from a
doctor-approved profile. The reader is a patient and their doctors. The doctor will edit it.

${style}
- Source only: never invent diagnoses, drugs, doses, numbers, targets or dates that are not in the profile.
  If something is not in the profile, leave the string empty ("") rather than guess.

Fields
${fields}
- "family_history", "allergy" and "medications" come from the profile's clinical section / background.
- "medications": current drugs and supplements; "name" = generic name, brand in parentheses if given.
- "problems": copy the profile's ranked problem list, same order; "level" high | medium | low (from the priority word).
- "plan": grouped by problem. Each group: "problem" = problem number (1, 2, 3...) or 0 for general plans;
  each item {"type", "action", "target", "follow_up"}; "target" = the measurable goal (e.g. "LDL-C < 70 mg/dL").
  Every action in the profile's plan must appear exactly once.
- "followup": a SHORT, easy-to-read schedule of tests and appointments only (re-tests, imaging, referrals, clinic visits).
  Do NOT include starting a drug, diet or exercise advice (those belong in "plan").
  "when" MUST be exactly one of these labels, nothing else: ${periods.map((x) => `"${x}"`).join(", ")}.
  Pick the closest label (e.g. 8–12 weeks or "within 3 months" -> the 3-month label; 6–12 months -> the 6-month label;
  1–2 years or annual -> the yearly label). Never put the timing or the word "recheck/follow-up" inside "item".
  "item" = a short name of the test or visit only (e.g. "HbA1c", "Lipid panel", "Eye exam", "Blood pressure check"),
  one test or visit per entry, in the language of the form. Put the same test only once.
  "problems" = array of the related problem numbers ([] if general).
- "problems" also need "short": a 1-3 word label for the problem used in the schedule (e.g. "Blood pressure", "Prediabetes", "Fatty liver"), in the language of the form.

Return the result by calling the submit_result tool.`;
};

const SHEET_SCHEMA = {
  type: "object",
  properties: {
    allergy: str,
    family_history: str,
    medications: {
      type: "array",
      items: { type: "object", properties: { name: str, use: str, status: str }, required: ["name", "use", "status"] },
    },
    problems: {
      type: "array",
      items: {
        type: "object",
        properties: { title_en: str, title_th: str, short: str, level: { type: "string", enum: ["high", "medium", "low"] }, evidence: str },
        required: ["title_en", "title_th", "short", "level", "evidence"],
      },
    },
    plan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          problem: { type: "integer" },
          items: {
            type: "array",
            items: { type: "object", properties: { type: str, action: str, target: str, follow_up: str }, required: ["type", "action", "target", "follow_up"] },
          },
        },
        required: ["problem", "items"],
      },
    },
    followup: {
      type: "array",
      items: {
        type: "object",
        properties: { when: str, item: str, problems: { type: "array", items: { type: "integer" } } },
        required: ["when", "item", "problems"],
      },
    },
  },
  required: ["allergy", "family_history", "medications", "problems", "plan", "followup"],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function callClaude(system: string, user: string, schema: object, deadline: number) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ใน Edge Function secrets");

  const remaining = deadline - Date.now();
  if (remaining < 15_000) throw new Error("AI ใช้เวลานานเกินไป ลองแบ่งโน้ตเป็นสองรอบ เช่น แล็บก่อน แล้วค่อย imaging");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), remaining);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        tools: [{ name: "submit_result", description: "Return the structured result", input_schema: schema }],
        tool_choice: { type: "tool", name: "submit_result" },
      }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("AI ใช้เวลานานเกินไป ลองตัดโน้ตให้สั้นลงแล้วส่งใหม่ หรือแบ่งเป็นสองรอบ");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text();
    console.error("Anthropic error", res.status, body.slice(0, 500));
    if (res.status === 401) throw new Error("ANTHROPIC_API_KEY ไม่ถูกต้อง");
    if (res.status === 429) throw new Error("เรียก AI ถี่เกินไป รอสักครู่แล้วลองใหม่");
    if (res.status === 400 && body.includes("credit")) throw new Error("เครดิตใน Anthropic account หมด");
    throw new Error(`Anthropic API ${res.status}`);
  }

  const data = await res.json();
  if (data.stop_reason === "max_tokens") {
    console.error("Output truncated at max_tokens");
    const err = new Error("TRUNCATED");
    (err as any).truncated = true;
    throw err;
  }
  const block = (data.content ?? []).find((b: any) => b.type === "tool_use");
  if (!block) {
    console.error("No tool_use block", JSON.stringify(data).slice(0, 400));
    throw new Error("AI ตอบกลับมาไม่ครบ ลองกดใหม่อีกครั้ง");
  }
  return block.input;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const deadline = Date.now() + DEADLINE_MS;

  // Only active doctors may use AI
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  const { data: prof } = await supabase.from("profiles").select("is_active").eq("id", user.id).single();
  if (!prof?.is_active) return json({ error: "Account not approved yet" }, 403);

  try {
    const body = await req.json();
    if (body.mode === "extract") {
      const context = body.patient_context ? `Patient context: ${body.patient_context}\n\n` : "";
      const names = Array.isArray(body.catalog_names) ? body.catalog_names.slice(0, 120).join(" | ") : "";
      const catalog = names
        ? `Clinic standard test names. In key_values, when a result matches one of these, use the EXACT name:\n${names}\n\n`
        : "";
      const prompt = `${catalog}${context}Findings note:\n${body.raw_note}`;
      const linesToText = (out: any) => {
        // กันพลาด: ถ้า AI ส่งหมวดที่ฐานข้อมูลไม่รู้จัก ให้เปลี่ยนเป็น biomarker
        for (const row of [...(out?.key_values ?? []), ...(out?.problems ?? [])]) {
          if (!CATEGORIES.includes(row.category)) row.category = "biomarker";
        }
        const DOMAINS = ["nutrition", "exercise", "sleep", "stress", "supplement", "medication", "follow_up_test", "referral", "other"];
        const FLAGS = ["normal", "low", "high", "borderline", "abnormal", "critical"];
        for (const p of out?.plan ?? []) if (!DOMAINS.includes(p.domain)) p.domain = "other";
        for (const p of out?.problems ?? []) if (!["high", "medium", "low"].includes(p.priority)) p.priority = "medium";
        for (const v of out?.key_values ?? []) if (!FLAGS.includes(v.flag)) v.flag = "normal";
        const sec = out?.sections ?? {};
        // สร้าง Plan ใต้หัวข้อปัญหา โดยดึงชื่อปัญหาจาก problem_list (เลขและชื่อตรงกันเสมอ)
        if (Array.isArray(sec.plan_groups)) {
          const titles = (Array.isArray(sec.problem_list) ? sec.problem_list : []).map((l: string) => {
            const m = String(l).match(/^\s*(\d+)[.)]\s*(.*)$/);
            const rest = m ? m[2] : String(l);
            return rest.split(" — ")[0].replace(/\s*\((High|Medium|Low)\)\s*$/i, "").trim();
          });
          const groups = [...sec.plan_groups]
            .filter((g: any) => Array.isArray(g.items) && g.items.length)
            .sort((x: any, y: any) => (x.problem || 999) - (y.problem || 999));
          const merged = new Map<number, string[]>();
          for (const g of groups) {
            const n = titles[g.problem - 1] ? g.problem : 0;
            merged.set(n, [...(merged.get(n) ?? []), ...g.items]);
          }
          sec.plan_text = [...merged.entries()]
            .map(([n, items]) => [n ? `${n}. ${titles[n - 1]}` : "General", ...items.map((i) => `- ${i}`)].join("\n"))
            .join("\n\n");
          delete sec.plan_groups;
        }
        for (const k of Object.keys(sec)) {
          if (!Array.isArray(sec[k])) continue;
          // ปัญหาและแผนมีเลขลำดับอยู่แล้ว ไม่ต้องใส่ bullet
          sec[k] = (k === "problem_list")
            ? sec[k].join("\n")
            : sec[k].map((l: string) => (String(l).startsWith("สรุป") ? l : `- ${l}`)).join("\n");
        }
        return out;
      };
      try {
        return json(linesToText(await callClaude(EXTRACT_SYSTEM, prompt, EXTRACT_SCHEMA, deadline)));
      } catch (e) {
        if (!(e as any).truncated) throw e;
        // ยาวเกินไป: แบ่งเรียกสองรอบแล้วรวมผล
        console.error("Retrying as two calls");
        const only = (cats: string, extra: string) =>
          `${EXTRACT_SYSTEM}\n\nIMPORTANT: this run covers ONLY these sections: ${cats}. ` +
          `Leave the other section keys empty (empty arrays, integrated as empty string). ${extra} Include every finding for your sections, plus the สรุป line.`;
        const merge = (x: any, y: any) => ({
          ...(x ?? {}),
          ...Object.fromEntries(Object.entries(y ?? {}).filter(([, v]) => (Array.isArray(v) ? v.length : v))),
        });
        const [a, b] = await Promise.all([
          callClaude(only("clinical, functional, biomarker", 'Return "key_values" as usual.'), prompt, EXTRACT_SCHEMA, deadline),
          callClaude(only("imaging, multiomic, integrated, problem_list, plan_groups", "Return key_values as usual. integrated, problem_list and plan_groups cover the WHOLE check-up."), prompt, EXTRACT_SCHEMA, deadline),
        ]);
        return json(linesToText({
          sections: merge(a.sections, b.sections),
          key_values: [...(a.key_values ?? []), ...(b.key_values ?? [])].slice(0, 16),
        }));
      }
    }
    if (body.mode === "sheet") {
      if (!body.profile || typeof body.profile !== "object") return json({ error: "ไม่มีข้อมูลโปรไฟล์" }, 400);
      const lang: SheetLang = body.language === "en" ? "en" : body.language === "th" ? "th" : "bi";
      return json(await callClaude(sheetSystem(lang), `Doctor-approved profile:\n${JSON.stringify(body.profile)}`, SHEET_SCHEMA, deadline));
    }
    if (body.mode === "translate") {
      if (!body.content || typeof body.content !== "object") return json({ error: "ไม่มีฉบับอังกฤษให้แปล" }, 400);
      const th = await callClaude(TRANSLATE_SYSTEM, `English summary (JSON):\n${JSON.stringify(body.content)}`, SUMMARY_SCHEMA, deadline);
      return json(await withinLimit(th, deadline));
    }
    if (body.mode === "summary") {
      const lang = body.language === "en" ? "en" : "th";
      const draft = await callClaude(summarySystem(lang), `Doctor-approved profile:\n${JSON.stringify(body.profile)}`, SUMMARY_SCHEMA, deadline);
      return json(await withinLimit(draft, deadline));
    }
    return json({ error: "Unknown mode" }, 400);
  } catch (e) {
    let msg = String((e as Error)?.message ?? e);
    if (msg === "TRUNCATED") msg = "โน้ตยาวมากจนสรุปไม่ครบ ลองแบ่งวางเป็นสองรอบ เช่น แล็บก่อน แล้วค่อย imaging";
    console.error("ai-assist failed:", msg);
    return json({ error: msg }, 500);
  }
});