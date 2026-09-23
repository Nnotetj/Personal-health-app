// Supabase Edge Function: ai-assist  (ฉบับแก้: ใช้ tool use บังคับรูปแบบ JSON)
// Deploy:  supabase functions deploy ai-assist
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// mode "extract": free-text findings  -> { findings[], problems[], plan[] }
// mode "summary": structured profile  -> patient-friendly 1-page content (th | en)

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
"plan_text" (inside sections): 3 to 10 items, ONE line each, grouped in problem order:
  "[#<problem number>] <Domain>: <action> | Target: <target> | <timeframe>"
  Use "[General]" instead of "[#n]" for plans not tied to one problem. Domain is a plain word such as
  Nutrition, Exercise, Sleep, Stress, Supplement, Medication, Follow-up test, Referral, Lifestyle.
  e.g. "[#1] Supplement: Start oral iron (ferrous fumarate) | Target: ferritin >30 ng/mL | Recheck CBC and ferritin in 8-12 weeks"
problem_list and plan_text do not count toward the 500-word limit and have no "สรุป:" line.

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

Length: the WHOLE text must be at most 500 words (Thai: similar length). Use only a few meaningful numbers
(e.g. body fat about 32%, stress 8/10, biological age about 43 vs actual age about 50); skip lab units and reference ranges.

MECE structure
- Group everything into 4 to 6 themes by what matters to the patient's life, e.g. heart, brain & blood vessels;
  weight, muscle & metabolism; nutrition, gut & energy; stress, mood & recovery; healthy aging & genetics.
- Mutually exclusive: each finding appears in ONE theme only; do not repeat it in another theme.
- Collectively exhaustive: every important finding or concern in the profile has a place. Items that only
  need monitoring go in "follow_up".
- Order themes by importance. Add " — Highest Priority" to the first theme title when it is clearly the most important.

Content
- "intro": 2-3 sentences. Start with the reassuring findings, then name the main focus areas.
- Each theme: "title"; "body" = 1 to 3 short paragraphs (what was found, what it means, reassuring points,
  what raises the risk); "plan" = ONE sentence of practical actions, or "" when the theme is information only
  (e.g. genetics). Genetic results show risk, not certainty — say so.
- "goals": exactly 3 items with labels ${lang === "th" ? '"อันดับแรก", "อันดับสอง", "อันดับสาม"' : '"First", "Second", "Third"'}, one short action-focused sentence each.
- "follow_up": one sentence listing what will be monitored.
- "closing": one encouraging sentence.
- Be honest and encouraging, never alarming. No bullet characters inside strings.

STYLE EXAMPLE (English, excerpt; never copy these findings into another patient)
intro: "Your health check shows a mix of good protective factors and a few important areas that need attention. The good news is that your heart pumping function is normal, your coronary calcium score is 0, your omega-3 level is good, and your biological age is younger than your actual age. However, your blood vessels, body composition, liver, lifestyle and stress level should become the main focus of your health plan."
theme: title "Heart, Brain & Blood Vessel Health — Highest Priority"
  body ["You have high cholesterol, early plaque in the neck arteries, and a small old 'silent stroke' seen on brain imaging, even though you have never had obvious stroke symptoms. Your heart ultrasound is normal and no calcium buildup was found in the coronary arteries, which is reassuring.", "However, because you smoke about 20 cigarettes per day, your overall blood vessel risk is still significant."]
  plan "Continue cholesterol treatment, stop smoking, monitor blood pressure and metabolic risk, exercise regularly, and follow a heart-healthy diet."
theme: title "Healthy Aging & Genetics"
  body ["Your biological age is about 43 years compared with an actual age of about 50, which is encouraging. However, your lung and musculoskeletal aging scores are less favorable.", "Genetic testing suggests higher susceptibility to some cardiovascular, metabolic, neurological and cancer-related conditions, but these results show risk, not certainty."]
  plan ""
goals: First "Protect your heart and brain by stopping smoking and controlling cholesterol." / Second "Reduce abdominal fat and build muscle." / Third "Improve liver, gut, nutrition, stress and sleep."
follow_up: "Thyroid nodule, brain and blood vessels, bone health, and metabolic health."
closing: "Your strongest opportunity is to turn good biological-aging potential into better long-term health by improving the modifiable risks that matter most."

Return the result by calling the submit_result tool.`;

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
        integrated: str, problem_list: strArr, plan_text: strArr,
      },
      required: ["clinical", "functional", "biomarker", "imaging", "multiomic", "integrated", "problem_list", "plan_text"],
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
        properties: { title: str, body: strArr, plan: str },
        required: ["title", "body", "plan"],
      },
    },
    goals: {
      type: "array",
      items: { type: "object", properties: { label: str, text: str }, required: ["label", "text"] },
    },
    follow_up: str,
    closing: str,
  },
  required: ["intro", "themes", "goals", "follow_up", "closing"],
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
        for (const k of Object.keys(sec)) {
          if (!Array.isArray(sec[k])) continue;
          // ปัญหาและแผนมีเลขลำดับอยู่แล้ว ไม่ต้องใส่ bullet
          sec[k] = (k === "problem_list" || k === "plan_text")
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
          callClaude(only("imaging, multiomic, integrated, problem_list, plan_text", "Return key_values as usual. integrated, problem_list and plan_text cover the WHOLE check-up."), prompt, EXTRACT_SCHEMA, deadline),
        ]);
        return json(linesToText({
          sections: merge(a.sections, b.sections),
          key_values: [...(a.key_values ?? []), ...(b.key_values ?? [])].slice(0, 16),
        }));
      }
    }
    if (body.mode === "summary") {
      const lang = body.language === "en" ? "en" : "th";
      return json(await callClaude(summarySystem(lang), `Doctor-approved profile:\n${JSON.stringify(body.profile)}`, SUMMARY_SCHEMA, deadline));
    }
    return json({ error: "Unknown mode" }, 400);
  } catch (e) {
    let msg = String((e as Error)?.message ?? e);
    if (msg === "TRUNCATED") msg = "โน้ตยาวมากจนสรุปไม่ครบ ลองแบ่งวางเป็นสองรอบ เช่น แล็บก่อน แล้วค่อย imaging";
    console.error("ai-assist failed:", msg);
    return json({ error: msg }, 500);
  }
});
