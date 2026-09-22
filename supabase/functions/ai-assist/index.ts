// Supabase Edge Function: ai-assist
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

const EXTRACT_SYSTEM = `You are a clinical data assistant for a preventive / longevity medicine clinic.
The doctor pastes pertinent findings from a full wellness check-up. Convert them into structured JSON.

Categories (use exactly these keys):
- "conventional": routine labs incl. CBC, FBG, HbA1c, insulin, lipid, CMP/LFT/renal, electrolytes, thyroid, sex & adrenal hormones, vitamins/minerals (vit D, B12, ferritin, Mg, zinc), hs-CRP/homocysteine, tumor markers, UA
- "multiomic": genetic (SNP, APOE, MTHFR, PRS), epigenetic (biological age, methylation), transcriptomic, proteomic, metabolomic (organic acids, amino acids), microbiomic (gut microbiome)
- "functional": physiologic testing — body composition (InBody/DEXA body fat, muscle mass, visceral fat), VO2 max, grip strength, HRV, BP, spirometry, CGM, sleep study
- "imaging": ultrasound, X-ray, CT, MRI, mammogram, DEXA bone density, echo, CAC score

Flags: "normal","low","high","borderline","abnormal","critical".
Priority: "high","medium","low".
Plan domain: "nutrition","exercise","sleep","stress","supplement","medication","follow_up_test","referral","other".

Rules:
- Only include what the note states or clearly implies. Never invent values.
- value_num = number only when the result is numeric, else null. Keep the original wording in value_text.
- Write test_name in standard English medical terms. interpretation: short, English, clinical.
- Problems: 2–6, ranked by clinical importance for proactive prevention. Each plan item may reference a problem by its index (problem_index, 0-based) or null.
- Reply with JSON only, no markdown fences, matching:
{"findings":[{"category":"","subcategory":"","test_name":"","value_text":"","value_num":null,"unit":"","ref_range":"","flag":"normal","interpretation":""}],
 "problems":[{"title":"","detail":"","priority":"medium","category":"conventional"}],
 "plan":[{"problem_index":0,"domain":"nutrition","action":"","target":"","timeframe":""}]}`;

const summarySystem = (lang: "th" | "en") => `You write a one-page personalised health summary FOR THE PATIENT (not the doctor).
Language: ${lang === "th" ? "Thai (ภาษาไทยที่เข้าใจง่าย สุภาพ ใช้ศัพท์แพทย์ภาษาอังกฤษในวงเล็บเมื่อจำเป็น)" : "plain English, friendly and clear"}.
Use the doctor-approved profile provided. Do not add diagnoses, numbers or treatments that are not in it.
Keep it short enough to fit one A4 page: headline ≤ 2 sentences, max 4 key numbers, max 4 priorities, max 5 plan groups with ≤ 3 actions each, max 4 next steps.
Explain "why it matters" in everyday language. Be encouraging, not alarming.
Reply with JSON only, no markdown fences:
{"headline":"",
 "key_numbers":[{"label":"","value":"","status":"good|watch|act"}],
 "priorities":[{"title":"","why":"","level":"high|medium|low"}],
 "plan":[{"domain":"nutrition|exercise|sleep|stress|supplement|medication|follow_up_test|referral|other","actions":[""]}],
 "next_steps":[{"what":"","when":""}]}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function callClaude(system: string, user: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  return JSON.parse(clean.slice(start, end + 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

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
      const names = Array.isArray(body.catalog_names) ? body.catalog_names.slice(0, 300).join(" | ") : "";
      const catalog = names
        ? `Clinic standard test names. When a result matches one of these, use the EXACT name in test_name:\n${names}\n\n`
        : "";
      return json(await callClaude(EXTRACT_SYSTEM, `${catalog}${context}Findings note:\n${body.raw_note}`));
    }
    if (body.mode === "summary") {
      const lang = body.language === "en" ? "en" : "th";
      return json(await callClaude(summarySystem(lang), `Doctor-approved profile:\n${JSON.stringify(body.profile)}`));
    }
    return json({ error: "Unknown mode" }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
