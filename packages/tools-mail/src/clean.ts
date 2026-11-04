// Message text for the model: the new part of a message only (Graph's `uniqueBody`, quoted
// history already dropped), signatures and legal disclaimers trimmed, invisible characters
// removed, clipped at a word boundary, and wrapped so the prompt can say what it is: third-party
// text, never an instruction (`untrusted_email_content`, decision 0016 and the pack's rules).
// Text hidden by the sender's HTML (white on white, display:none) survives Graph's conversion to
// text; the wrapper, the rules and the write protocol are the defence (docs/SECURITY.md).

export interface Untrusted {
  untrusted_email_content: string
}

export function untrusted(text: string): Untrusted {
  return { untrusted_email_content: text }
}

// Lines that start a disclaimer or a client footer: everything from the first one on is dropped,
// as long as some text stays before it.
const HARD_CUT = [
  /^-- ?$/,
  /^_{5,}$/,
  /^(sent from my|poslano s mog|poslano iz|get outlook for)\b/i,
  /^(this (e-?mail|message)( and any attachments?)? (is|are|may be) (confidential|intended))/i,
  /^(ova (e-?mail )?poruka( i (svi )?privici)? (je|su|može|namijenjen))/i,
  /^(confidentiality notice|disclaimer|napomena o povjerljivosti|izjava o odricanju)\b/i,
]
// A sign-off: cut only when what follows looks like a signature (a few lines, none a sentence),
// so "Thanks!\nThe deadline moved to Friday." keeps its second line.
const SIGN_OFF =
  /^(s poštovanjem|srdačan pozdrav|lijep pozdrav|lp|pozdrav|hvala i pozdrav|best regards|kind regards|regards|best|thanks|many thanks|cheers)[,!.]?$/i
const SIGNATURE_MAX_LINES = 4

// Format characters (zero-width, bidi embeddings and isolates, the Unicode tag block used for
// "ASCII smuggling", soft hyphen), C0/C1 controls except tab and newline, variation selectors,
// the combining grapheme joiner and the Hangul fillers: text a human reading the same message
// would not see.
/* eslint-disable no-control-regex, no-misleading-character-class -- these invisible characters are what this removes */
const INVISIBLE = /[\p{Cf}\u0000-\u0008\u000B-\u001F\u007F-\u009F͏ᅟᅠㅤ︀-️\u{E0100}-\u{E01EF}]/gu
/* eslint-enable no-control-regex, no-misleading-character-class */

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '')
}

/** Plain text of a message body: invisible characters out, disclaimer and signature cut, blank
 * runs collapsed. */
export function cleanBody(text: string): string {
  let lines = stripInvisible(text).replace(/\r\n?/g, '\n').split('\n')
  const hasTextBefore = (i: number) => lines.slice(0, i).some((l) => l.trim() !== '')
  const hard = lines.findIndex((l, i) => HARD_CUT.some((re) => re.test(l.trim())) && hasTextBefore(i))
  if (hard >= 0) lines = lines.slice(0, hard)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!SIGN_OFF.test(lines[i]!.trim()) || !hasTextBefore(i)) continue
    const after = lines.slice(i + 1).filter((l) => l.trim() !== '')
    if (after.length <= SIGNATURE_MAX_LINES && after.every((l) => !/[.?!:]$/.test(l.trim())))
      lines = lines.slice(0, i)
    break
  }
  return lines
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** One line for a list: whitespace collapsed, invisible characters out. */
export function oneLine(text: string): string {
  return stripInvisible(text).replace(/\s+/g, ' ').trim()
}

/** One third-party line, clipped: a subject, a name, a location. */
export function field(text: string | null | undefined, max: number): string {
  return clip(oneLine(text ?? ''), max).text
}

/** At most `max` characters, cut at a word boundary when one is near, never inside a surrogate
 * pair (a lone half is not valid JSON text for Postgres), with `…`. */
export function clip(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  let cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  const space = cut.lastIndexOf(' ')
  const head = space > max * 0.8 ? cut.slice(0, space) : cut
  return { text: `${head.trimEnd()}…`, truncated: true }
}
