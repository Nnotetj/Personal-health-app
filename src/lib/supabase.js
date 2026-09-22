import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export const CLINIC_NAME = import.meta.env.VITE_CLINIC_NAME || 'Wellness Clinic'

export async function aiAssist(payload) {
  const { data, error } = await supabase.functions.invoke('ai-assist', { body: payload })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).error || msg } catch {}
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}
