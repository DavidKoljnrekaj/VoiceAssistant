// Text as the voice should read it. The voice prompt asks the model for this too; this is the
// deterministic backstop before text-to-speech. Ported from Landmark's voice sink with two
// additions from the plan: markdown links lose their target, runs of blank lines collapse.
//
// TIC, OIB and IBAN are said as words and declined (Landmark's phase 0 decision); markup would be
// read aloud; "EUR" and "€" are read as "eura". Pure and deterministic: the same input always
// gives the same output, and it reads no clock, locale or environment.

/** Rewrites one stretch of model text into what text-to-speech should read. */
export function speakable(text: string): string {
  return (
    text
      // Acronyms as declined lower-case words: "TIC-u" → "ticu", "OIB-a" → "oiba".
      .replace(/\bTIC(?:-?(a|u|om|e|ovi|ova))?\b/g, (_, s: string | undefined) => `tic${s ?? ''}`)
      .replace(/\bOIB(?:-?(a|u|om|i))?\b/g, (_, s: string | undefined) => `oib${s ?? ''}`)
      .replace(/\bIBAN(?:-?(a|u|om|i))?\b/g, (_, s: string | undefined) => `iban${s ?? ''}`)
      .replace(/\bEUR\b|€/g, 'eura')
      // A markdown link or image reads as its text; the target is never spoken.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Emphasis, code spans, headings and list bullets are markup, not speech.
      .replace(/\*\*|__|`|^#+\s*|^\s*[-*]\s+/gm, '')
      // Three or more newlines are one paragraph break for the synthesiser.
      .replace(/\n{3,}/g, '\n\n')
  )
}
