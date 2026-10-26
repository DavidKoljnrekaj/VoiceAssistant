#!/usr/bin/env node
// PostToolUse hook (Edit|Write, async): run Prettier on the file that was just written so CI
// never fails on formatting. Only files inside the project with a known extension; never fails.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
  const file = input.tool_input?.file_path ?? ''
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd())
  const abs = resolve(file)
  const inside = abs.startsWith(root + sep)
  if (inside && /\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml)$/.test(abs) && existsSync(abs)) {
    spawnSync('pnpm', ['exec', 'prettier', '--write', '--log-level', 'silent', abs], {
      cwd: root,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    })
  }
} catch {
  // formatting is best effort: never block the session
}
process.exit(0)
