// One call's turns: the per-call turn cap, the identity read (cached up to a minute), the
// `last_seen_at` bump, the engine turn and its timing line. The LiveKit adapter
// (`assistant-llm.ts`) hands every user turn here; the bench runs turns through it too.
import { randomUUID } from 'node:crypto'

import { type InMemoryMessage, log, MESSAGES_HR, type SpokenEnd } from '@va/core'

import type { CallIdentity } from './call.js'
import { LOG_TAG, type VoiceDeps } from './config.js'
import { runVoiceTurn, type VoiceTurnResult } from './turn.js'

/** The brief's voice rate limit: turns per call. */
export const MAX_TURNS_PER_CALL = 50

export interface TurnIO {
  messages: InMemoryMessage[]
  say: (text: string) => Promise<void>
  end: (reason: SpokenEnd) => Promise<void>
  signal: AbortSignal
}

export interface CallSessionOptions {
  maxTurns?: number
  pickFiller?: () => string
}

export class CallSession {
  private turns = 0
  private readonly pending = new Set<Promise<unknown>>()
  private readonly maxTurns: number

  constructor(
    private readonly deps: VoiceDeps,
    readonly identity: CallIdentity,
    private readonly options: CallSessionOptions = {},
  ) {
    this.maxTurns = options.maxTurns ?? MAX_TURNS_PER_CALL
  }

  /** A user turn: what is spoken goes to `say`; `end` is called once unless a barge-in cancels
   * the turn. Returns the turn's result, or null when it was refused before the model. The turn
   * and its deferred write are tracked so `settle()` can wait for them. */
  turn(io: TurnIO): Promise<VoiceTurnResult | null> {
    const result = this.runTurn(io)
    this.track(result.then((r) => r?.persisted))
    return result
  }

  private async runTurn(io: TurnIO): Promise<VoiceTurnResult | null> {
    const requestId = randomUUID()
    const ids = { request_id: requestId, user_id: this.identity.userId, session_id: this.identity.sessionId }
    if (++this.turns > this.maxTurns) {
      log('warn', LOG_TAG, 'turn limit reached', { ...ids, turns: this.turns, limit: this.maxTurns })
      await io.say(MESSAGES_HR.rate_limited)
      await io.end('error')
      return null
    }
    const t0 = performance.now()
    let ctx
    try {
      ctx = await this.identity.ctx()
    } catch (err) {
      const code = err instanceof Error ? err.message : 'internal_error'
      log('warn', LOG_TAG, 'identity refused', { ...ids, code })
      const message =
        code in MESSAGES_HR ? MESSAGES_HR[code as keyof typeof MESSAGES_HR] : MESSAGES_HR.unauthorized
      await io.say(message)
      await io.end('error')
      return null
    }
    const authMs = Math.round(performance.now() - t0)
    this.identity.touch()
    const result = await runVoiceTurn({
      deps: this.deps,
      ctx,
      sessionId: this.identity.sessionId,
      messages: io.messages,
      requestId,
      say: io.say,
      end: io.end,
      signal: io.signal,
      ...(this.options.pickFiller ? { pickFiller: this.options.pickFiller } : {}),
    })
    // Where a turn's time goes: identity, then the model and tools until the first spoken text,
    // then the rest of the answer.
    log('info', LOG_TAG, 'timing', {
      ...ids,
      turn: this.turns,
      auth_ms: authMs,
      first_text_ms: result.firstTextMs,
      total_ms: result.totalMs,
      marks: result.marks.join(' '),
      spoken_len: result.spoken.length,
      input_tokens: result.usage.input,
      output_tokens: result.usage.output,
      cache_read_tokens: result.usage.cacheRead,
      cache_write_tokens: result.usage.cacheWrite,
      outcome: result.outcome,
    })
    return result
  }

  private track(p: Promise<unknown>): void {
    this.pending.add(p)
    void p.catch(() => {}).finally(() => this.pending.delete(p))
  }

  /** Resolves once every turn in flight and every deferred write has settled (the tests and
   * the call's end wait on it). */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.pending])
  }
}
