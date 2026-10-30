// docs/OPS.md → Configuration lists every variable each env.ts validates (Part 7 acceptance).
// env.ts reads import.meta.env at import time, so the names are taken from its source text.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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
  it('X03: docs/OPS.md names every VITE_ variable of the PWA', () => {
    const root = join(import.meta.dirname, '..', '..', '..', '..')
    const source = readFileSync(join(import.meta.dirname, 'env.ts'), 'utf8')
    const names = [...new Set(source.match(/VITE_[A-Z0-9_]+/g))]
    expect(names.length).toBeGreaterThanOrEqual(3)
    const listed = matrixNames(readFileSync(join(root, 'docs', 'OPS.md'), 'utf8'))
    expect(names.filter((name) => !listed.has(name))).toEqual([])
  })

  it('X03b: every matrix row for the web names a VITE_ variable env.ts reads', () => {
    const root = join(import.meta.dirname, '..', '..', '..', '..')
    const source = readFileSync(join(import.meta.dirname, 'env.ts'), 'utf8')
    const rows = matrixRows(readFileSync(join(root, 'docs', 'OPS.md'), 'utf8')).filter((row) =>
      row.apps.includes('web'),
    )
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows.map((row) => row.name).filter((name) => !source.includes(name))).toEqual([])
  })
})
