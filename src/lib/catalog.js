import { supabase } from './supabase'

let cache = null

export async function loadCatalog(force = false) {
  if (cache && !force) return cache
  const { data } = await supabase.from('test_catalog').select('*').eq('is_active', true).order('sort_order')
  cache = buildIndex(data || [])
  return cache
}
export const invalidateCatalog = () => { cache = null }

// "25-OH Vitamin D" -> "25ohvitamind", "VO₂ max" -> "vo2max"
export const keyOf = (s) =>
  (s || '').toLowerCase().normalize('NFKD').replace(/₂/g, '2').replace(/[^a-z0-9ก-๙]/g, '')

function buildIndex(rows) {
  const byKey = new Map()
  const byCode = new Map()
  rows.forEach((r) => {
    byCode.set(r.code, r)
    ;[r.name, r.code, ...(r.aliases || [])].forEach((n) => { const k = keyOf(n); if (k && !byKey.has(k)) byKey.set(k, r) })
  })
  return { rows, byKey, byCode }
}

export function matchTest(catalog, name) {
  if (!catalog || !name) return null
  const k = keyOf(name)
  if (catalog.byKey.has(k)) return catalog.byKey.get(k)
  // tolerate trailing words like "LDL-C (direct)" or "HbA1c NGSP"
  for (const [ak, row] of catalog.byKey) if (ak.length >= 3 && k.startsWith(ak) && k.length - ak.length <= 8) return row
  return null
}

export function rangeFor(entry, sex) {
  if (!entry) return { low: null, high: null }
  const f = sex === 'F'
  return {
    low: f && entry.ref_low_f != null ? Number(entry.ref_low_f) : entry.ref_low != null ? Number(entry.ref_low) : null,
    high: f && entry.ref_high_f != null ? Number(entry.ref_high_f) : entry.ref_high != null ? Number(entry.ref_high) : null,
  }
}

export function refText(entry, sex) {
  if (!entry) return ''
  const { low, high } = rangeFor(entry, sex)
  if (low != null && high != null) return low === high ? `${low}` : `${low}-${high}`
  if (high != null) return `≤${high}`
  if (low != null) return `≥${low}`
  return entry.ref_text || ''
}

// Returns suggested flag, or null when the catalog has no numeric rule
export function computeFlag(entry, value, sex, unit) {
  if (!entry || value === '' || value == null || isNaN(Number(value))) return null
  if (unitMismatch(entry, unit)) return null
  const v = Number(value)
  const { low, high } = rangeFor(entry, sex)
  if (low == null && high == null) return null
  const lc = entry.low_cutoff != null ? Number(entry.low_cutoff) : null
  const hc = entry.high_cutoff != null ? Number(entry.high_cutoff) : null
  if (high != null && v > high) return hc != null && v < hc ? 'borderline' : 'high'
  if (low != null && v < low) return lc != null && v >= lc ? 'borderline' : 'low'
  return 'normal'
}

export const unitMismatch = (entry, unit) =>
  !!(entry?.unit && unit && keyOf(unit) !== keyOf(entry.unit))

// Apply catalog to one finding row: canonical name/code, fill empty unit/ref/subcategory
export function normalizeFinding(catalog, f, sex) {
  const entry = f.test_code ? catalog?.byCode.get(f.test_code) : matchTest(catalog, f.test_name)
  if (!entry) return { ...f, test_code: '' }
  return {
    ...f,
    test_code: entry.code,
    test_name: entry.name,
    category: entry.category,
    subcategory: f.subcategory || entry.subcategory || '',
    unit: f.unit || entry.unit || '',
    ref_range: f.ref_range || refText(entry, sex),
  }
}

// Trend key: catalog code when known, otherwise normalised name
export const trendKey = (f) => f.test_code || `n:${keyOf(f.test_name)}`
