// Vocabulary hints for Soniox: the committed list in `apps/voice/hints/hr.txt`, one term per
// line, `#` comments allowed. An integration pack will contribute its own terms later.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HINTS_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hints', 'hr.txt')

export function parseHints(text: string): string[] {
  const terms = text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0)
  return [...new Set(terms)]
}

export function loadHints(file = HINTS_FILE): string[] {
  return parseHints(readFileSync(file, 'utf8'))
}
