#!/usr/bin/env node
// Stop hook: before Claude ends a turn that changed TypeScript in a workspace package, typecheck
// each affected package and run the Vitest files related to the changed sources. On failure,
// exit 2 — Claude receives stderr and carries on fixing. Blocks at most once per turn
// (stop_hook_active). A green run is stamped by hash so an unchanged tree is not re-verified.
// CI is the full check.
import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
if (input.stop_hook_active) process.exit(0)

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
process.chdir(root)

const git = (args) => {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}
const hasHead = git('rev-parse --verify HEAD').trim() !== ''
const isSource = (f) => /^(packages|apps)\/[^/]+\/.*\.(ts|tsx)$/.test(f) && existsSync(f)
const changed = [
  ...(hasHead ? git('diff --name-only HEAD').split('\n') : git('ls-files').split('\n')),
  ...git('ls-files --others --exclude-standard').split('\n'),
].filter(isSource)
if (changed.length === 0) process.exit(0)

// Map each file to its workspace package: the first two path segments (apps/api, packages/core).
const packages = [...new Set(changed.map((f) => f.split('/').slice(0, 2).join('/')))]

// Skip when nothing changed since the last green run (tracked diff + untracked contents).
const stampDir = 'node_modules/.cache'
const stampFile = `${stampDir}/stop-verify`
const hasher = createHash('sha1').update(hasHead ? git('diff HEAD -- packages apps') : '')
for (const f of changed) hasher.update(`\n--- ${f}\n`).update(readFileSync(f))
const hash = hasher.digest('hex')
if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === hash) process.exit(0)

const tail = (s, n = 60) => s.split('\n').slice(-n).join('\n')
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' })

for (const pkg of packages) {
  const tsc = run('pnpm', ['--filter', `./${pkg}`, 'typecheck'])
  if (tsc.status !== 0) {
    process.stderr.write(
      `Typecheck fails in ${pkg} — fix it before finishing:\n${tail(tsc.stdout + tsc.stderr)}\n`,
    )
    process.exit(2)
  }
}

const tests = run('pnpm', ['exec', 'vitest', 'related', '--run', ...changed])
if (tests.status !== 0) {
  process.stderr.write(
    `Tests related to your changes fail — fix the code, not the test, unless the test is wrong (then say why):\n${tail(tests.stdout + tests.stderr)}\n`,
  )
  process.exit(2)
}

mkdirSync(stampDir, { recursive: true })
writeFileSync(stampFile, hash)
process.exit(0)
