// Message text for the model: the new part of a message only (Graph's `uniqueBody`, quoted
// history already dropped), signatures and legal disclaimers trimmed, control characters
// removed, clipped at a word boundary, and wrapped so the prompt can say what it is: third-party
// text, never an instruction (`untrusted_email_content`, decision 0016 and the pack's rules).

export interface Untrusted {
  untrusted_email_content: string
}

export function untrusted(text: string): Untrusted {
  return { untrusted_email_content: text }
}

// A line that starts a signature or a disclaimer: everything from it on is dropped, as long as
// some text stays before it.
const CUT_LINE = [
  /^-- ?$/,
  /^_{5,}$/,
  /^(s poštovanjem|srdačan pozdrav|lijep pozdrav|lp|pozdrav|hvala i pozdrav)[,!.]?$/i,
  /^(best regards|kind regards|regards|best|thanks|many thanks|cheers)[,!.]?$/i,
  /^(sent from my|poslano s mog|poslano iz|get outlook for)\b/i,
  /^(this (e-?mail|message)( and any attachments?)? (is|are|may be) (confidential|intended))/i,
  /^(ova (e-?mail )?poruka( i (svi )?privici)? (je|su|može|namijenjen))/i,
  /^(confidentiality notice|disclaimer|napomena o povjerljivosti|izjava o odricanju)\b/i,
]

// C0/C1 controls except tab and newline, zero-width and bidi overrides: invisible text is how an
// injection hides from the human who later reads the same message.
/* eslint-disable no-control-regex -- the control characters are what this removes */
const INVISIBLE = new RegExp(
  '[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\uFEFF]',
  'g',
)
/* eslint-enable no-control-regex */

/** Plain text of a message body: invisible characters out, signature and disclaimer cut, blank
 * runs collapsed. */
export function cleanBody(text: string): string {
  const lines = text.replace(INVISIBLE, '').replace(/\r\n?/g, '\n').split('\n')
  let end = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (CUT_LINE.some((re) => re.test(line)) && lines.slice(0, i).some((l) => l.trim() !== '')) {
      end = i
      break
    }
  }
  return lines
    .slice(0, end)
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** One line for a list: whitespace collapsed, invisible characters out. */
export function oneLine(text: string): string {
  return text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
}

/** At most `max` characters, cut at a word boundary when one is near, with `…`. */
export function clip(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  const head = space > max * 0.8 ? cut.slice(0, space) : cut
  return { text: `${head.trimEnd()}…`, truncated: true }
}
