#!/usr/bin/env node
// PreToolUse hook (Edit|Write): if an edit to an existing test file removes or rewrites an
// assertion, or adds .skip/.only/.todo, ask the user before it is applied. Additions pass silently.
// Ported from Landmark; covers Vitest files (*.test.ts), Playwright specs (*.spec.ts) and pgTAP
// files under supabase/tests/.
import { existsSync, readFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
const file = input.tool_input?.file_path ?? ''
if (!/\.(test|spec)\.(ts|tsx)$|\/supabase\/tests\/.*\.sql$/.test(file) || !existsSync(file)) process.exit(0)

const before = input.tool_name === 'Edit' ? (input.tool_input.old_string ?? '') : readFileSync(file, 'utf8')
const after =
  input.tool_name === 'Edit' ? (input.tool_input.new_string ?? '') : (input.tool_input.content ?? '')

const assertion = /\b(expect|it|test|describe|ok|is|isnt|results_eq|throws_ok|lives_ok|is_empty)\b[\w.]*\s*\(/
const lines = (s) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => assertion.test(l))
const kept = new Set(lines(after))
const removed = lines(before).filter((l) => !kept.has(l))
const skipped = /\.(skip|only|todo)\s*\(/.test(after) && !/\.(skip|only|todo)\s*\(/.test(before)

if (removed.length === 0 && !skipped) process.exit(0)

const reason = [
  `This edit to ${file.replace(process.env.CLAUDE_PROJECT_DIR + '/', '')} ${skipped ? 'adds .skip/.only/.todo' : 'removes or changes existing assertions'}:`,
  ...removed.slice(0, 6).map((l) => `  - ${l}`),
  'Approve only if the old expectation was wrong, not because it was failing.',
].join('\n')
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  }),
)
process.exit(0)
