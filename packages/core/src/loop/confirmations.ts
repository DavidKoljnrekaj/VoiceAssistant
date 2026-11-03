// The write protocol's building blocks (docs/plan/12-write-protocol.md, decision 0015): the
// stable hash that ties a confirmation to the exact input the user saw summarised, the result
// the model reads while a confirmation is pending (it carries no id), the expiry, and an
// in-memory store (the voice worker's per-call store, and the reference the tests use).
import { createHash } from 'node:crypto'

import type { ConfirmationStore, ConsumeMatch, ConsumeResult, PendingConfirmation } from './ports.js'

/** How long a pending confirmation may be answered. */
export const CONFIRMATION_TTL_MS = 5 * 60_000

/** What the model reads instead of the handler's output. English, like every tool result; the
 * model says it in Croatian. No id: the channel holds that. */
export function pendingResult(summary: string): {
  pending_confirmation: true
  summary: string
  instruction: string
} {
  return {
    pending_confirmation: true,
    summary,
    instruction:
      'Nothing was done yet. Tell the user, in your own words, what would happen and ask for their ' +
      'confirmation. Do not call this tool again until the user has answered.',
  }
}

/** JSON with keys sorted at every level, so two equal inputs hash alike whatever the order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** SHA-256 of the validated input, as hex. */
export function inputHash(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex')
}

interface MemoryRow extends PendingConfirmation {
  id: string
  outcome: 'pending' | 'executed' | 'failed' | 'declined' | 'expired'
  errorCode?: string
}

/**
 * Confirmations kept in memory: the voice worker's store for one call (a call is one process and
 * its ids mean nothing outside it), and the fakes' store in the engine tests. `rows` is readable
 * so a test can assert what was issued and settled.
 */
export class MemoryConfirmationStore implements ConfirmationStore {
  readonly rows: MemoryRow[] = []
  private counter = 0

  constructor(private readonly now: () => number = Date.now) {}

  async issue(c: PendingConfirmation): Promise<{ id: string }> {
    const id = `cf-${String(++this.counter).padStart(4, '0')}-${crypto.randomUUID()}`
    this.rows.push({ ...c, id, outcome: 'pending' })
    return { id }
  }

  async consume(id: string, match: ConsumeMatch): Promise<ConsumeResult> {
    const row = this.rows.find((r) => r.id === id)
    if (!row) return 'not_found'
    if (row.sessionId !== match.sessionId || row.userId !== match.userId) return 'not_found'
    if (row.outcome !== 'pending') return 'used'
    if (Date.parse(row.expiresAt) <= this.now()) {
      row.outcome = 'expired'
      return 'expired'
    }
    if (row.tool !== match.tool || row.inputHash !== match.inputHash) return 'mismatch'
    row.outcome = 'executed'
    return 'ok'
  }

  async settle(id: string, outcome: 'executed' | 'failed', errorCode?: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id)
    if (!row) return
    row.outcome = outcome
    if (errorCode) row.errorCode = errorCode
  }

  async decline(id: string, match: Pick<ConsumeMatch, 'sessionId' | 'userId'>): Promise<boolean> {
    const row = this.rows.find(
      (r) => r.id === id && r.sessionId === match.sessionId && r.userId === match.userId,
    )
    if (!row || row.outcome !== 'pending') return false
    row.outcome = 'declined'
    return true
  }
}
