// docs/OPS.md → Configuration lists every variable each env.ts validates (Part 7 acceptance).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { apiEnvSchema } from '../src/env.js'

/** The names in the first column of docs/OPS.md → The matrix, and nothing from the prose. */
function matrixNames(doc: string): Set<string> {
  const start = doc.indexOf('### The matrix')
  const rest = doc.slice(start + 1)
  const end = rest.search(/\n##+ /)
  const section = rest.slice(0, end === -1 ? undefined : end)
  const names = new Set<string>()
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    const first = line.split('|')[1] ?? ''
    for (const m of first.matchAll(/`([A-Z0-9_]+)`/g)) names.add(m[1]!)
  }
  return names
}

describe('env matrix', () => {
  it('X01: docs/OPS.md names every API variable', () => {
    const doc = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'OPS.md'), 'utf8')
    const names = matrixNames(doc)
    const missing = Object.keys(apiEnvSchema.shape).filter((name) => !names.has(name))
    expect(missing).toEqual([])
  })
})
