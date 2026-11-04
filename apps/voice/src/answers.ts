// The caller's answer to a pending write, decided in code before the model sees the turn: a
// closed set of Croatian yeses and nos, matched whole after normalisation. Anything longer or
// different is a plain turn (the model handles it; a confirmation it asks for again gets a new
// preview). Closed on purpose: "da, ali…" must not confirm. <!-- needs native review -->

export type Answer = 'yes' | 'no' | 'other'

const YES = new Set([
  'da',
  'da da',
  'moze',
  'da moze',
  'u redu',
  'ok',
  'okej',
  'potvrdujem',
  'potvrdi',
  'posalji',
  'da posalji',
  'naravno',
  'svakako',
  'tocno',
  'tako je',
])
const NO = new Set([
  'ne',
  'ne ne',
  'nemoj',
  'ne hvala',
  'odustani',
  'odustajem',
  'ne salji',
  'nemoj slati',
  'stop',
  'prekini',
  'otkazi',
])

/** Lower case, diacritics folded, punctuation dropped, one space between words. */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/č|ć/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function classifyAnswer(text: string): Answer {
  const n = normalizeAnswer(text)
  if (YES.has(n)) return 'yes'
  if (NO.has(n)) return 'no'
  return 'other'
}
