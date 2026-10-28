// LiveKit's own logger (pino) writes what the caller said and what the agent answered on its
// `info` and `warn` lines, under keys that start with `lk.pii.` (`lk.pii.user_input`,
// `lk.pii.message`, `lk.pii.transcript`, ...). The worker never logs content (invariant 9), so
// every JSON line that leaves the process on stdout loses those keys here. The prefix is the
// framework's own convention for personal data, so a key added in a later version is covered
// too; the worker forces JSON output for this to see every line.
import { Writable } from 'node:stream'

export const PII_PREFIX = 'lk.pii.'

/** A JSON log line without its `lk.pii.*` keys; anything that is not a JSON object is returned
 * as it came. */
export function redactLine(line: string): string {
  if (!line.startsWith('{') || !line.includes(PII_PREFIX)) return line
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return line
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return line
  const out: Record<string, unknown> = {}
  let removed = 0
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key.startsWith(PII_PREFIX)) removed++
    else out[key] = value
  }
  if (removed > 0) out.redacted = removed
  return JSON.stringify(out)
}

/** Every line of a chunk through `redactLine`, keeping the chunk's line breaks. */
export function redactChunk(chunk: string): string {
  return chunk
    .split('\n')
    .map((line) => redactLine(line))
    .join('\n')
}

let installed = false

/** Wraps `process.stdout.write` once so that no `lk.pii.*` key reaches the log sink. */
export function installStdoutRedaction(stream: Writable = process.stdout): void {
  if (installed) return
  installed = true
  const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean
  stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : null
    if (text === null || !text.includes(PII_PREFIX)) return write(chunk, ...rest)
    return write(redactChunk(text), ...rest)
  }) as typeof stream.write
}
