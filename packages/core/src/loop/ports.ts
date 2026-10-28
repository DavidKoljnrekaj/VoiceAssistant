// The three ports a channel plugs into the loop, and the loop's own input and config shapes.
// Unchanged from Landmark except where docs/plan/03-core-engine.md says: `textBlock` carries the
// row id, `MessageRow` carries `turn_kind` and the cache counts, and the Anthropic client is
// injected through the config (the engine reads no environment).
import type Anthropic from '@anthropic-ai/sdk'

import type { Json } from '@va/db'

import type { AuthContext } from '../auth.js'
import type { Channel, ChannelSettings } from '../channel.js'
import type { ErrorCode } from '../errors.js'
import type { ToolHandlerExtras } from '../tools/define.js'
import type { ToolRegistry } from '../tools/registry.js'

/** A content block as persisted and replayed: the SDK's shapes for what the engine reads
 * (`text`, `tool_use`, `tool_result`), anything else verbatim. */
export interface ContentBlock {
  type: string
  [k: string]: unknown
}

export interface TextBlock extends ContentBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock extends ContentBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export interface ToolResultBlock extends ContentBlock {
  type: 'tool_result'
  tool_use_id: string
  /** The handler's output as a JSON string: the API requires a string here. */
  content: string
  is_error: boolean
}

/** One message of the conversation as sent to the model. */
export interface InMemoryMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

/** The token counts a `done` event carries. */
export interface Usage {
  input_tokens: number
  output_tokens: number
}

/** What `hooks.usage` receives per model call, including what the prompt cache served. */
export interface UsageReport {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Where the loop's events go. One per channel; every method may be a no-op. */
export interface EventSink {
  /** Provisional text as it streams. The `textBlock` that follows is canonical. */
  textDelta(text: string): Promise<void>
  /** The model started a `tool_use` block: the voice sink speaks its filler here. */
  toolStarting(): Promise<void>
  /** A whole text block, after its row is persisted; `messageId` is that row. */
  textBlock(text: string, messageId: string): Promise<void>
  toolCall(tool: string, input: unknown, id: string): Promise<void>
  /** After the `tool_result` row is persisted. */
  toolResult(tool: string, output: unknown, id: string, isError: boolean): Promise<void>
  done(stopReason: string, usage: Usage): Promise<void>
  error(code: ErrorCode, message: string): Promise<void>
}

/** One `ai_messages` row without its session (the store knows it). */
export interface MessageRow {
  role: 'user' | 'assistant'
  turn_kind: 'user' | 'assistant' | 'tool_result'
  content: Json
  parent_id: string | null
  model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_tokens?: number | null
  cache_write_tokens?: number | null
  stop_reason?: string | null
}

export interface MessageStore {
  /** Persists a row: the new id, or null with the error code. Never throws. */
  insert(row: MessageRow): Promise<{ id: string | null; code?: string }>
}

export type LoopMark = 'model_call' | 'first_event' | 'tools_start' | 'tools_done'

export interface LoopHooks {
  /** Checked before each model call, between the model call and dispatch, and after dispatch. */
  isCancelled(): Promise<boolean>
  /** After a terminal answer: not after an error, not after a cancel. */
  onComplete(): Promise<void>
  mark?(event: LoopMark): void
  usage?(usage: UsageReport): void
}

export interface LoopConfig {
  anthropic: Anthropic
  channel: Channel
  settings: ChannelSettings
  /** The static block (with the cache breakpoint) first, then the uncached per-user blocks. */
  system: Anthropic.TextBlockParam[]
  /** `registry.anthropicTools(ctx, channel)`: sorted, strict, breakpoint on the last. */
  tools: Anthropic.Tool[]
  registry: ToolRegistry
  /** The owning channel's log tag, e.g. `[api]`. */
  logTag: string
}

export interface LoopInput {
  sessionId: string
  /** The assembled history plus the user turn just persisted. Mutated by the loop. */
  messages: InMemoryMessage[]
  /** The row the next one chains off: the user turn just persisted. */
  lastInsertedId: string
  extras: ToolHandlerExtras
}

export type LoopContext = AuthContext
