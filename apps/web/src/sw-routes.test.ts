// The built service worker, read back as text: the two backend origins must be answered by
// NetworkOnly routes (`.claude/rules/web.md`: `/chat`, `/voice/*` and Supabase are never cached).
// A function `urlPattern` is serialised into sw.js without its closure, so only a pattern that
// carries the origin itself can be verified here, which is the point of the test (WEB-15).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'va-web-sw-'))

// The three VITE_ variables come from vitest.config.ts (`test.env` also sets process.env, which
// loadEnv reads), so the build sees the same two origins the unit tests fake.
const API_ORIGIN = new URL(process.env.VITE_API_URL ?? '').origin
const SUPABASE_ORIGIN = new URL(process.env.VITE_SUPABASE_URL ?? '').origin

beforeAll(async () => {
  await build({
    root: webRoot,
    configFile: join(webRoot, 'vite.config.ts'),
    mode: 'production',
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  })
}, 120_000)
afterAll(() => rmSync(outDir, { recursive: true, force: true }))

describe('the built service worker', () => {
  it('WEB-15: answers the API and Supabase origins with NetworkOnly routes', () => {
    // Regex-serialised origins carry escaped slashes and dots; strip the escapes before matching.
    const sw = readFileSync(join(outDir, 'sw.js'), 'utf8').replace(/\\/g, '')
    expect(sw).toContain(API_ORIGIN)
    expect(sw).toContain(SUPABASE_ORIGIN)
    expect(sw.match(/NetworkOnly/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // The route closures must not have been stringified without their origin.
    expect(sw).not.toMatch(/url\.origin===origin/)
  })

  it('WEB-15: precaches the shell and nothing from the backend origins', () => {
    const sw = readFileSync(join(outDir, 'sw.js'), 'utf8')
    expect(sw).toContain('"index.html"')
    expect(sw).toContain('precacheAndRoute')
    const precache = sw.slice(sw.indexOf('precacheAndRoute'), sw.indexOf('registerRoute'))
    expect(precache).not.toContain(API_ORIGIN.replace(/\//g, '\\/'))
    expect(precache).not.toContain(SUPABASE_ORIGIN.replace(/\//g, '\\/'))
  })
})
