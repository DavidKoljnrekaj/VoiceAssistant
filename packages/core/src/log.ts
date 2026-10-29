// One JSON object per line, with a tag, ids, codes, timings and counts. Never message content
// (CLAUDE.md invariant 9): callers pass lengths and codes, not text. `log-fields.test.ts` scans
// every call site in apps/* and packages/* for a content-shaped field name. The field names of
// the per-turn `timing` lines are documented in docs/OPS.md → Logging and kept stable.

export type LogLevel = 'info' | 'warn' | 'error'

/** How much of a third party's error message a log line may carry. */
export const REASON_MAX_CHARS = 200

export function log(level: LogLevel, tag: string, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), tag, event, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/**
 * The `reason` field of an error line: the error's class and its message, whitespace collapsed
 * and cut to `REASON_MAX_CHARS`. Messages from Supabase, LiveKit or the SDKs are not ours and
 * can be long; they are not message content, but they are truncated before they reach a sink.
 */
export function errorReason(err: unknown): string {
  if (err instanceof Error) {
    const message = err.message.replace(/\s+/g, ' ').trim()
    const head = message.length > REASON_MAX_CHARS ? `${message.slice(0, REASON_MAX_CHARS)}…` : message
    return head ? `${err.constructor.name}: ${head}` : err.constructor.name
  }
  const text = String(err).replace(/\s+/g, ' ').trim()
  return text.length > REASON_MAX_CHARS ? `${text.slice(0, REASON_MAX_CHARS)}…` : text
}
