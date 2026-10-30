// How a call ends from the worker's side, LiveKit-free so it can be tested: the hang-up that
// waits for the agent to finish a last sentence (the goodbye on the cap, the fallback on a
// provider failure) before the credential goes and the job shuts down.

/** How long a hang-up waits for the agent to speak its last line before going ahead anyway
 * (text-to-speech may be the thing that failed). */
export const HANGUP_GRACE_MS = 10_000

export class HangUp {
  private pending: { reason: string; timer: NodeJS.Timeout } | null = null
  private done = false

  /** `finish` runs once, with the first reason given. */
  constructor(
    private readonly finish: (reason: string) => void,
    private readonly graceMs = HANGUP_GRACE_MS,
  ) {}

  /** Hangs up once the agent has stopped speaking (`spoke()`), or after the grace period. */
  afterSpeech(reason: string): void {
    if (this.done || this.pending) return
    this.pending = { reason, timer: setTimeout(() => this.now(reason), this.graceMs) }
  }

  /** The agent stopped speaking: a pending hang-up goes ahead. */
  spoke(): void {
    if (this.pending) this.now(this.pending.reason)
  }

  /** Hangs up at once (the room is gone, the session closed). */
  now(reason: string): void {
    if (this.done) return
    this.done = true
    if (this.pending) clearTimeout(this.pending.timer)
    this.pending = null
    this.finish(reason)
  }
}
