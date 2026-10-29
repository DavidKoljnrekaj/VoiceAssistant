// The engine as the session's LLM: design A of docs/plan/05-voice-worker.md §3. The installed
// @livekit/agents (1.9.2) types `llmNode` as returning `ReadableStream<ChatChunk | string |
// FlushSentinel>`, and the activity's `performLLMInference` consumes plain strings as text,
// calls `cancel()` on the stream when the caller interrupts, and ends the current TTS segment on
// a `FlushSentinel`. So the agent overrides `llmNode`, runs the shared loop in-process with the
// `SpokenTextSink`, and turns each paragraph break the sink emits (after the filler) into a
// flush: the filler is synthesised at once instead of waiting for the answer, which is what
// Landmark's `ParagraphAgent.ttsNode` did by hand. No ttsNode override is needed.
//
// The activity still wants an `LLM` instance on the pipeline (it returns without one), so a
// stub stands in; its `chat()` is never called because `llmNode` never delegates to it.
import { ReadableStream } from 'node:stream/web'

import { type ChatChunk, FlushSentinel, type llm as llmNs, llm, voice } from '@livekit/agents'

import { log, type SpokenEnd } from '@va/core'

import { LOG_TAG } from './config.js'
import { toAnthropicMessages } from './messages.js'
import type { CallSession, TurnIO } from './session.js'

export type EngineChunk = string | FlushSentinel

/** Never answers: `AssistantAgent.llmNode` runs the engine instead. */
export class EngineLLM extends llm.LLM {
  constructor(private readonly modelId: string) {
    super()
  }
  label(): string {
    return 'va-engine'
  }
  override get model(): string {
    return this.modelId
  }
  override get provider(): string {
    return 'anthropic'
  }
  chat(): llmNs.LLMStream {
    throw new Error('EngineLLM.chat: AssistantAgent overrides llmNode; the engine runs in-process')
  }
}

/**
 * The stream LiveKit reads: `say` enqueues text, a paragraph break becomes a flush, `end`
 * closes it, and a cancel (barge-in) aborts the turn's signal. Closing after a cancel is a
 * no-op.
 */
export function engineStream(
  run: (io: Pick<TurnIO, 'say' | 'end' | 'signal'>) => Promise<unknown>,
): ReadableStream<EngineChunk> {
  const abort = new AbortController()
  let open = true
  return new ReadableStream<EngineChunk>({
    start(controller) {
      const enqueue = (chunk: EngineChunk): void => {
        if (open) controller.enqueue(chunk)
      }
      const close = (): void => {
        if (!open) return
        open = false
        controller.close()
      }
      const say = async (text: string): Promise<void> => {
        const parts = text.split('\n\n')
        parts.forEach((part, i) => {
          if (part) enqueue(part)
          if (i < parts.length - 1) enqueue(FlushSentinel)
        })
      }
      const end = async (_reason: SpokenEnd): Promise<void> => close()
      void run({ say, end, signal: abort.signal })
        .catch((err: unknown) => {
          log('error', LOG_TAG, 'engine stream failed', {
            reason: err instanceof Error ? err.constructor.name : typeof err,
          })
        })
        .finally(close)
    },
    cancel() {
      open = false
      abort.abort()
    },
  })
}

/** Unused by the engine (the system prompt lives in @va/core); LiveKit requires a value. */
const INSTRUCTIONS = 'The system prompt is built by @va/core; see docs/VOICE.md.'

export class AssistantAgent extends voice.Agent {
  constructor(
    private readonly call: CallSession,
    modelId: string,
  ) {
    super({ instructions: INSTRUCTIONS, llm: new EngineLLM(modelId) })
  }

  override async llmNode(
    chatCtx: llmNs.ChatContext,
    _toolCtx: llmNs.ToolContext,
    _modelSettings: voice.ModelSettings,
  ): Promise<ReadableStream<ChatChunk | string | FlushSentinel> | null> {
    const messages = toAnthropicMessages(chatCtx.items)
    if (!messages) {
      log('warn', LOG_TAG, 'no user turn to answer', { items: chatCtx.items.length })
      return null
    }
    return engineStream((io) => this.call.turn({ messages, ...io }))
  }
}
