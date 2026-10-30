// docs/OPS.md → Configuration lists every variable each env.ts validates (Part 7 acceptance).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { voiceEnvSchema } from '../src/env.js'

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

/** Each matrix row: the variable names of the first column with the apps of the second. */
function matrixRows(doc: string): { name: string; apps: string[] }[] {
  const start = doc.indexOf('### The matrix')
  const rest = doc.slice(start + 1)
  const end = rest.search(/\n##+ /)
  const section = rest.slice(0, end === -1 ? undefined : end)
  const rows: { name: string; apps: string[] }[] = []
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|')
    const apps = (cells[2] ?? '')
      .split(',')
      .map((cell) => cell.trim().split(/\s/)[0] ?? '')
      .filter((app) => /^[a-z]+$/.test(app))
    for (const m of (cells[1] ?? '').matchAll(/`([A-Z0-9_]+)`/g)) rows.push({ name: m[1]!, apps })
  }
  return rows
}

describe('env matrix', () => {
  it('X02: docs/OPS.md names every voice worker variable', () => {
    const doc = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'OPS.md'), 'utf8')
    const names = matrixNames(doc)
    const missing = Object.keys(voiceEnvSchema.shape).filter((name) => !names.has(name))
    expect(missing).toEqual([])
  })

  it('X02b: every matrix row for the voice names a variable env.ts validates', () => {
    const doc = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'OPS.md'), 'utf8')
    const rows = matrixRows(doc).filter((row) => row.apps.includes('voice'))
    expect(rows.length).toBeGreaterThan(3)
    const unknown = rows.map((row) => row.name).filter((name) => !(name in voiceEnvSchema.shape))
    expect(unknown).toEqual([])
  })
})
