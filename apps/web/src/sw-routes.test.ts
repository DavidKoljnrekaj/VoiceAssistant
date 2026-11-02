// The built service worker, read back as text: the two backend origins must be answered by
// NetworkOnly routes (`.claude/rules/web.md`: `/chat`, `/voice/*` and Supabase are never cached).
// A function `urlPattern` is serialised into sw.js without its closure, so only a pattern that
// carries the origin itself can be verified here, which is the point of the test (WEB-15).
// The routes are GET only (Workbox's default, pinned here on purpose): a non-GET request matches
// no route, so the worker never handles it and the browser sends it itself, and the Cache API
// stores no non-GET response, so nothing of `/chat`, `/voice/*` or `/sessions/*` can be kept.
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

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * The registration Workbox writes for one origin. Under Vitest NODE_ENV is `test`, so the PWA
 * plugin emits the development worker, `registerRoute(/^http:\/\/api\.test(\/|$)/, new
 * workbox.NetworkOnly(), 'GET')`; a deploy build minifies it to `...,new e.NetworkOnly,"GET")`.
 * Both match; a function pattern (`({url})=>url.origin===origin`), a pattern without the origin
 * or another method fails.
 */
function networkOnlyGetRoute(origin: string): RegExp {
  const pattern = new RegExp(`^${escapeRegExp(origin)}(/|$)`).toString()
  return new RegExp(
    `registerRoute\\(${escapeRegExp(pattern)},\\s*new \\w+\\.NetworkOnly(?:\\(\\))?,\\s*["']GET["']\\)`,
  )
}

describe('the built service worker', () => {
  it('WEB-15: answers the API and Supabase origins with NetworkOnly routes, each a RegExp on the origin, GET only', () => {
    const sw = readFileSync(join(outDir, 'sw.js'), 'utf8')
    expect(sw).toMatch(networkOnlyGetRoute(API_ORIGIN))
    expect(sw).toMatch(networkOnlyGetRoute(SUPABASE_ORIGIN))
    // Exactly the two routes: no route for another method (see the header) and no third origin.
    expect(sw.match(/new \w+\.NetworkOnly/g)).toHaveLength(2)
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
