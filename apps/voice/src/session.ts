// One call's turns: the per-call turn cap, the identity read (cached up to a minute), the
// `last_seen_at` bump, the engine turn and its timing line. The LiveKit adapter
// (`assistant-llm.ts`) hands every user turn here; the bench runs turns through it too.
import { randomUUID } from 'node:crypto'

import { type ErrorCode, log, MESSAGES_HR, type SpokenEnd } from '@va/core'

import type { CallIdentity } from './call.js'
import { LOG_TAG, type VoiceDeps } from './config.js'
import { CALL_ENDED_HR } from './greeting.js'
import { type CallRow, callHistory } from './messages.js'
import { runVoiceTurn, type VoiceTurnResult } from './turn.js'

/** What the caller hears when the identity cannot be read (`call_ended` is handled before). */
export function identityCode(
  err: unknown,
): Extract<ErrorCode, 'unauthorized' | 'no_profile' | 'internal_error'> {
  const message = err instanceof Error ? err.message : ''
  if (message === 'unauthorized') return 'unauthorized'
  if (message === 'no_profile') return 'no_profile'
  return 'internal_error'
}

/** The brief's voice rate limit: turns per call. */
export const MAX_TURNS_PER_CALL = 50

export interface TurnIO {
  /** What the caller just said. */
  userText: string
  say: (text: string) => Promise<void>
  end: (reason: SpokenEnd) => Promise<void>
  signal: AbortSignal
}

export interface CallSessionOptions {
  maxTurns?: number
  pickFiller?: () => string
  /** Called once, after the goodbye was handed to the stream, when the call's row is gone (the
   * 15-minute cap, or the API's end): the owner hangs up. */
  onEnded?: (reason: 'call_ended') => void
}

export class CallSession {
  private turns = 0
  private readonly pending = new Set<Promise<unknown>>()
  /** The call's turns run one after another: a turn LiveKit starts while the cancelled one is
   * still unwinding (a barge-in) waits for it, so its history has the cut-short turn's rows and
   * its save chains off them (VOICE-9). */
  private last: Promise<unknown> = Promise.resolve()
  /** The call's saves run one after another, so each turn chains off the previous one's rows. */
  private saves: Promise<unknown> = Promise.resolve()
  /** The call's own rows so far, the model's history (tool rounds included; VOICE-5). */
  private readonly rows: CallRow[] = []
  private readonly maxTurns: number
  /** Set once the goodbye was spoken: later turns (the caller spoke before the hang-up landed)
   * say nothing. */
  private ended = false

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
    const result = this.last.then(() => this.runTurn(io))
    this.last = result.catch(() => {})
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
    if (this.ended) {
      await io.end('done')
      return null
    }
    const t0 = performance.now()
    let ctx
    try {
      ctx = await this.identity.ctx()
    } catch (err) {
      // The row is gone: the cap, or the API ended the call. One goodbye, then the owner hangs up.
      if (err instanceof Error && err.message === 'call_ended') {
        this.ended = true
        log('info', LOG_TAG, 'call ended', { ...ids, turn: this.turns })
        await io.say(CALL_ENDED_HR)
        await io.end('done')
        this.options.onEnded?.('call_ended')
        return null
      }
      // The auth codes are the caller's situation (spoken as "not signed in"); anything else
      // (a failed lookup) is ours.
      const code = identityCode(err)
      log('warn', LOG_TAG, 'identity refused', { ...ids, code })
      await io.say(MESSAGES_HR[code])
      await io.end('error')
      return null
    }
    const authMs = Math.round(performance.now() - t0)
    this.identity.touch()
    const result = await runVoiceTurn({
      deps: this.deps,
      ctx,
      sessionId: this.identity.sessionId,
      history: callHistory(this.rows),
      userText: io.userText,
      requestId,
      say: io.say,
      end: io.end,
      signal: io.signal,
      persistAfter: this.saves,
      ...(this.options.pickFiller ? { pickFiller: this.options.pickFiller } : {}),
    })
    this.saves = result.persisted
    this.rows.push(...result.rows)
    // Where a turn's time goes: identity, then the model and tools until the first spoken text,
    // then the rest of the answer; the marks say when each model call and tool round started
    // and ended (`docs/OPS.md` → log fields).
    log('info', LOG_TAG, 'timing', {
      ...ids,
      turn: this.turns,
      auth_ms: authMs,
      first_text_ms: result.firstTextMs,
      total_ms: result.totalMs,
      marks: result.marks.map((m) => `${m.name}@${m.atMs}`).join(' '),
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
