// The voice channel's EventSink: the loop's text as sentences for text-to-speech, nothing else.
// Ported from Landmark's `OpenAiChunkSink` without its wire format: the voice worker runs the
// loop in-process and hands `say` straight to the TTS adapter.
//
//   - textDelta is spoken a word at a time, after `speakable()`, up to the last whitespace so an
//     abbreviation is never split across two chunks. The first sentence of each stretch of text
//     is held until the next token shows what follows it: if a tool call starts instead, the
//     sentence was the model announcing a lookup ("Trebam prvo pronaći projekt…"), which the
//     filler already covers, so it is dropped. A finished sentence that nothing follows within
//     `HOLD_MS` is spoken anyway (VOICE-8): a one-sentence answer must not wait for the end of
//     the generation, and a lookup the model announces that late is spoken before the filler;
//   - toolStarting speaks one filler sentence per request, followed by a paragraph break, so the
//     caller does not sit in silence while tools run;
//   - textBlock repeats text already streamed as deltas, so it is spoken only when it was not
//     (the loop's own messages: the iteration cap, truncation);
//   - toolCall and toolResult are not spoken;
//   - done flushes what is pending and, after a refusal with nothing said, speaks the refusal
//     line; error flushes and speaks the Croatian message. Both then call `end`.

import { MESSAGES_HR, type ErrorCode } from '../errors.js'
import type { EventSink, Usage } from '../loop/ports.js'
import { speakable } from './speakable.js'

/** Spoken once per request when the first tool call starts. Written without an ellipsis: some
 * TTS engines read "…" literally. <!-- needs native review --> */
export const FILLERS_HR: readonly string[] = [
  'Samo trenutak, provjeravam.',
  'Trenutak, gledam podatke.',
  'Samo malo, dohvaćam to.',
]

export type SpokenEnd = 'done' | 'error'

/** How long a finished first sentence waits for the next token before it is spoken anyway. A
 * token follows within a few tens of milliseconds while the model is still writing; a tool
 * call's `between_tools` thinking takes longer, which is the trade-off S13c pins. */
export const HOLD_MS = 200

function randomFiller(): string {
  return FILLERS_HR[Math.floor(Math.random() * FILLERS_HR.length)]!
}

export class SpokenTextSink implements EventSink {
  private pending = ''
  private streamed = ''
  private fillerSpoken = false
  private holding = true
  private holdTimer: ReturnType<typeof setTimeout> | null = null
  /** Everything spoken so far, after `speakable()`. */
  spoken = ''
  /** When the first text went to `say` (`performance.now()`), for the owner's timing log. */
  firstOutputAt: number | null = null

  constructor(
    private readonly sayText: (text: string) => Promise<void>,
    private readonly end: (reason: SpokenEnd) => Promise<void>,
    private readonly pickFiller: () => string = randomFiller,
    private readonly holdMs: number = HOLD_MS,
  ) {}

  private async say(text: string): Promise<void> {
    if (!text) return
    const content = speakable(text)
    this.firstOutputAt ??= performance.now()
    this.spoken += content
    await this.sayText(content)
  }

  /** A space before a new sentence when what was spoken does not already end in whitespace. */
  private joiner(): string {
    return this.spoken && !/\s$/.test(this.spoken) ? ' ' : ''
  }

  // Up to the last whitespace, so an abbreviation is never split across chunks.
  private async flushWords(): Promise<void> {
    const cut = Math.max(this.pending.lastIndexOf(' '), this.pending.lastIndexOf('\n'))
    if (cut === -1) return
    const ready = this.pending.slice(0, cut + 1)
    this.pending = this.pending.slice(cut + 1)
    await this.say(ready)
  }

  private async flushAll(): Promise<void> {
    const rest = this.pending
    this.pending = ''
    await this.say(rest)
  }

  async textDelta(text: string): Promise<void> {
    this.streamed += text
    this.pending += text
    if (this.holding) {
      // Released once a sentence has ended and more text follows it, or after the hold.
      if (!/[.!?](\s+)\S/.test(this.pending)) {
        if (/[.!?]\s*$/.test(this.pending)) this.armHold()
        return
      }
      this.clearHold()
      this.holding = false
    }
    await this.flushWords()
  }

  private armHold(): void {
    if (this.holdTimer !== null) return
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null
      void this.releaseHold()
    }, this.holdMs)
  }

  private clearHold(): void {
    if (this.holdTimer === null) return
    clearTimeout(this.holdTimer)
    this.holdTimer = null
  }

  /** The hold ran out: the sentence is spoken whole (its last word has no whitespace after it). */
  private async releaseHold(): Promise<void> {
    if (!this.holding) return
    this.holding = false
    if (/[.!?]\s*$/.test(this.pending)) await this.flushAll()
    else await this.flushWords()
  }

  async toolStarting(): Promise<void> {
    // Held text followed by a tool call is an announcement of the lookup.
    this.clearHold()
    if (this.holding) this.pending = ''
    this.holding = true
    if (this.fillerSpoken) return
    this.fillerSpoken = true
    await this.flushAll()
    // The paragraph break makes the TTS synthesise the filler at once: it holds a sentence back
    // until more text arrives, and the answer only comes after the tools have run.
    await this.say(`${this.joiner()}${this.pickFiller()}\n\n`)
  }

  async textBlock(text: string, _messageId: string): Promise<void> {
    if (this.streamed.startsWith(text)) {
      this.streamed = this.streamed.slice(text.length)
      return
    }
    await this.flushAll()
    await this.say(`${this.joiner()}${text}`)
  }

  async toolCall(_tool: string, _input: unknown, _id: string): Promise<void> {}
  async toolResult(_tool: string, _output: unknown, _id: string, _isError: boolean): Promise<void> {}

  async done(stopReason: string, _usage: Usage): Promise<void> {
    this.clearHold()
    await this.flushAll()
    // A declined request (after any fallback) ends with nothing to say.
    if (stopReason === 'refusal' && !this.spoken.trim()) await this.say(MESSAGES_HR.model_refused)
    await this.end('done')
  }

  async error(_code: ErrorCode, message: string): Promise<void> {
    this.clearHold()
    await this.flushAll()
    await this.say(`${this.joiner()}${message}`)
    await this.end('error')
  }
}
