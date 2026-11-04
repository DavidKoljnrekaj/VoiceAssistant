// What the worker hands the engine for every turn and for the warm-up: the Anthropic client,
// the registry, the voice settings and a clock, turned into a `LoopConfig` for one caller. The
// system blocks are the static voice prompt (with the cache breakpoint), the per-user block and
// the date line; the warm-up sends the same blocks, so the first question hits the cache.
import type Anthropic from '@anthropic-ai/sdk'

import {
  type AuthContext,
  buildStaticSystemPrompt,
  buildUserContext,
  type Channel,
  type ChannelSettings,
  type ConfirmationStore,
  dateLine,
  type LoopConfig,
  MemoryConfirmationStore,
  type ToolRegistry,
} from '@va/core'

export const LOG_TAG = '[voice]'

/** The two spoken channels this worker answers: the in-app call and the phone (Part 11). */
export type SpokenChannel = Extract<Channel, 'voice' | 'phone'>

export interface VoiceDeps {
  anthropic: Anthropic
  registry: ToolRegistry
  /** Which channel's prompt, settings and allowlist a call uses. */
  channel: SpokenChannel
  settings: ChannelSettings
  clock: () => Date
}

/** `confirmations` is the call's own store (`CallSession` keeps one); the warm-up needs none. */
export function voiceLoopConfig(
  deps: VoiceDeps,
  ctx: AuthContext,
  confirmations: ConfirmationStore = new MemoryConfirmationStore(),
): LoopConfig {
  return {
    anthropic: deps.anthropic,
    channel: deps.channel,
    settings: deps.settings,
    system: [
      {
        type: 'text',
        text: buildStaticSystemPrompt(deps.channel, deps.registry.domainRules()),
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: buildUserContext(ctx) },
      { type: 'text', text: dateLine(deps.clock()) },
    ],
    tools: deps.registry.anthropicTools(ctx, deps.channel),
    registry: deps.registry,
    confirmations,
    logTag: LOG_TAG,
  }
}
