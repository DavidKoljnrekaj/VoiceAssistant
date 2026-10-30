// One streamed model turn. The call goes through the beta endpoint when the model profile
// carries beta headers; both styles stream the same events and the same final message. Text
// deltas and tool starts reach the sink as they arrive; an abort returns silently and any other
// failure is mapped to a code the loop emits.
import type Anthropic from '@anthropic-ai/sdk'

import { mapAnthropicError, type MappedError } from '../errors.js'
import { errorReason } from '../log.js'
import type { ModelProfile } from '../model.js'
import type { ContentBlock, EventSink, InMemoryMessage, LoopConfig, LoopHooks } from './ports.js'

/** The parts of the final message the loop reads, identical for the stable and beta endpoints. */
export interface ModelMessage {
  model: string
  content: ContentBlock[]
  stop_reason: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number | null
    cache_creation_input_tokens?: number | null
  }
}

export type ModelTurn =
  | { kind: 'message'; message: ModelMessage }
  | { kind: 'aborted' }
  /** `reason` is `errorReason(err)`: the SDK's class and message cut to `REASON_MAX_CHARS`, the
   * rejected field of an our-fault request included. */
  | { kind: 'failed'; mapped: MappedError; errorClass: string; reason: string }

export async function streamModelTurn(
  config: LoopConfig,
  profile: ModelProfile,
  messages: InMemoryMessage[],
  sink: EventSink,
  hooks: LoopHooks,
  signal: AbortSignal,
): Promise<ModelTurn> {
  const { settings } = config
  const params: Anthropic.MessageStreamParams = {
    model: settings.model,
    max_tokens: settings.maxTokens,
    system: config.system,
    messages: messages as unknown as Anthropic.MessageParam[],
    ...(config.tools.length > 0 ? { tools: config.tools } : {}),
    ...profile.extra,
  }
  hooks.mark?.('model_call')
  let firstEvent = true
  try {
    const stream =
      profile.betas.length > 0
        ? (config.anthropic.beta.messages.stream(
            { ...params, betas: profile.betas } as unknown as Parameters<
              Anthropic['beta']['messages']['stream']
            >[0],
            { signal },
          ) as unknown as ReturnType<Anthropic['messages']['stream']>)
        : config.anthropic.messages.stream(params, { signal })
    for await (const ev of stream) {
      if (firstEvent && (ev.type === 'content_block_start' || ev.type === 'content_block_delta')) {
        firstEvent = false
        hooks.mark?.('first_event')
      }
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        await sink.textDelta(ev.delta.text)
      } else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
        await sink.toolStarting()
      }
    }
    const final = (await stream.finalMessage()) as unknown as ModelMessage
    hooks.usage?.({
      input: final.usage.input_tokens,
      output: final.usage.output_tokens,
      cacheRead: final.usage.cache_read_input_tokens ?? 0,
      cacheWrite: final.usage.cache_creation_input_tokens ?? 0,
    })
    return { kind: 'message', message: final }
  } catch (err) {
    if (signal.aborted) return { kind: 'aborted' }
    const errorClass = err instanceof Error ? err.constructor.name : typeof err
    return { kind: 'failed', mapped: mapAnthropicError(err), errorClass, reason: errorReason(err) }
  }
}
