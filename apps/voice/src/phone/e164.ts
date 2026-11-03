// Caller ID as the trunk presents it, normalised to E.164 (`+385…`) or refused. Pure, so the
// edge cases are a table test. A withheld or malformed number is null: the caller is refused
// before any lookup (docs/plan/11-phone-channel.md §3).

/** The country a national number (`0…`) is assumed to be in. */
export const DEFAULT_COUNTRY_CODE = '385'

const E164 = /^\+[1-9][0-9]{6,14}$/

/** What trunks send for a withheld number, lower-cased. */
const WITHHELD = new Set(['', 'anonymous', 'restricted', 'unavailable', 'unknown', 'private', 'withheld'])

/**
 * `+385911234567`, `00385911234567`, `0911234567`, `385911234567`, `tel:+385…` and
 * `sip:+385…@…` all become `+385911234567`; spaces, dots, dashes and parentheses are ignored.
 * Null for a withheld, empty or malformed value.
 */
export function normalizeE164(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  let s = raw.trim().toLowerCase()
  if (WITHHELD.has(s)) return null
  // `sip:+385…@host` and `tel:+385…`: keep the user part.
  s = s.replace(/^(sip|sips|tel):/, '')
  const at = s.indexOf('@')
  if (at !== -1) s = s.slice(0, at)
  s = s.replace(/[\s.\-()]/g, '')
  if (WITHHELD.has(s)) return null
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  else if (s.startsWith('0')) s = `+${DEFAULT_COUNTRY_CODE}${s.slice(1)}`
  else if (/^[1-9]/.test(s)) s = `+${s}`
  return E164.test(s) ? s : null
}
