#!/usr/bin/env node
// SessionStart hook (once): print the state a session should know before it starts. Stdout becomes
// additional context for Claude. Names only — never the contents of an env file.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'n/a'
  }
}

const lines = ['[session-context]']
lines.push(`branch: ${sh('git branch --show-current') || '(detached)'}`)
lines.push(
  `node: ${process.version}, pnpm: ${sh('pnpm --version')}, supabase cli: ${sh('supabase --version')}`,
)

const apps = existsSync(join(root, 'apps')) ? readdirSync(join(root, 'apps')) : []
for (const app of apps) {
  const dir = join(root, 'apps', app)
  const envFiles = readdirSync(dir).filter((f) => /^\.env(\..+)?$/.test(f) && !f.endsWith('.example'))
  lines.push(
    `apps/${app}: ${envFiles.length ? `env files present: ${envFiles.join(', ')}` : 'no .env file (copy .env.example)'}`,
  )
}

const refFile = join(root, 'supabase', '.temp', 'project-ref')
if (existsSync(refFile)) {
  lines.push(`supabase linked project ref: ${readFileSync(refFile, 'utf8').trim()}`)
  lines.push(
    'Reminder: during development the linked project must never be the production ref. Nothing is applied, pushed or generated against it without being asked in this conversation.',
  )
} else {
  lines.push('supabase: no linked project (supabase/.temp/project-ref absent)')
}

lines.push(
  'Before saying work is done run /done. Read docs/plan/00-brief.md and the current part for context.',
)
process.stdout.write(lines.join('\n') + '\n')
