// One JSON object per line, with a tag, ids, codes, timings and counts. Never message content
// (CLAUDE.md invariant 9): callers pass lengths and codes, not text.

export type LogLevel = 'info' | 'warn' | 'error'

export function log(level: LogLevel, tag: string, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ tag, event, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
