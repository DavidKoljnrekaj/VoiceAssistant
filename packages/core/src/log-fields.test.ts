// A lint-style test over the source tree: every `log(...)` call site in apps/* and packages/*
// carries ids, codes, timings and counts, never a field whose name says content (invariant 9,
// docs/OPS.md → Logging). The scan is textual and sees the call's own literal, including
// shorthand properties; what a spread such as `...ids` brings in is not resolved, so an `ids`
// object is read by a reviewer, not by this test.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')
export const FORBIDDEN_LOG_FIELDS = [
  'text',
  'message',
  'content',
  'transcript',
  'token',
  'jwt',
  // Variant names that carry the same content: a credential, a prompt, an answer, a body.
  'callToken',
  'call_token',
  'accessToken',
  'access_token',
  'prompt',
  'answer',
  'body',
  'email',
  'input',
] as const
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'logs', 'e2e', 'public'])
const SOURCE_ROOTS = ['apps', 'packages']

/** Every .ts / .tsx source file under apps/* and packages/*, tests and the fakes excluded. */
function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
    }
  }
  for (const root of SOURCE_ROOTS) walk(join(ROOT, root))
  return out.filter((f) => !f.includes(`${sep}packages${sep}core${sep}src${sep}test${sep}`))
}

/** The text of each `log(` call in a source (not `console.log`, not `.log(`), with its line. */
export function logCalls(source: string): { line: number; text: string }[] {
  const calls: { line: number; text: string }[] = []
  const re = /(^|[^.\w$])log\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const start = m.index + m[1]!.length
    const open = start + 'log'.length
    let depth = 0
    let i = open
    let quote: string | null = null
    for (; i < source.length; i++) {
      const ch = source[i]!
      if (quote) {
        if (ch === '\\') i++
        else if (ch === quote) quote = null
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch
      else if (ch === '(') depth++
      else if (ch === ')' && --depth === 0) break
    }
    calls.push({ line: source.slice(0, start).split('\n').length, text: source.slice(start, i + 1) })
    re.lastIndex = i
  }
  return calls
}

/** The forbidden field names used as object keys in a call, string literals removed first. */
export function forbiddenKeys(call: string): string[] {
  const noStrings = call.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""')
  // `key:` (a property) or a bare `key` between `{` / `,` and `,` / `}` (shorthand).
  const names = FORBIDDEN_LOG_FIELDS.join('|')
  const re = new RegExp(`(?:^|[{,\\s])(${names})\\s*(?::|(?=\\s*[,}]))`, 'g')
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(noStrings)) !== null) found.push(m[1]!)
  return found
}

describe('log fields', () => {
  it('L04: no log call site in apps/* or packages/* carries a content-shaped field', () => {
    const violations: string[] = []
    let scanned = 0
    for (const file of sourceFiles()) {
      for (const call of logCalls(readFileSync(file, 'utf8'))) {
        scanned++
        for (const key of forbiddenKeys(call.text)) {
          violations.push(`${relative(ROOT, file)}:${call.line} logs \`${key}\``)
        }
      }
    }
    expect(scanned).toBeGreaterThan(50)
    expect(violations).toEqual([])
  })

  it('L05: the scanner sees a forbidden key through nesting, spreads and multi-line calls', () => {
    const sample = `
      log('error', '[x]', 'persist failed', {
        ...ids,
        rows: 3,
        message: err.message,
      })
      log('info', TAG, 'ok', { input_tokens: 1, message_id: 'm', reason: 'no message: here' })
      other.log({ text: 'not ours' })
      console.log({ token: 'not ours' })
      log('warn', TAG, 'nested', { meta: { transcript: t } })
      log('info', TAG, 'shorthand', { ...ids, text, jwt })
      log('info', TAG, 'shorthand-last', {
        count,
        token
      })
      log('info', TAG, 'variants', { callToken, access_token: t, input_tokens: 1, body })
    `
    const calls = logCalls(sample)
    expect(calls).toHaveLength(6)
    expect(forbiddenKeys(calls[0]!.text)).toEqual(['message'])
    expect(forbiddenKeys(calls[1]!.text)).toEqual([])
    expect(forbiddenKeys(calls[2]!.text)).toEqual(['transcript'])
    expect(forbiddenKeys(calls[3]!.text)).toEqual(['text', 'jwt'])
    expect(forbiddenKeys(calls[4]!.text)).toEqual(['token'])
    expect(forbiddenKeys(calls[5]!.text)).toEqual(['callToken', 'access_token', 'body'])
  })
})
