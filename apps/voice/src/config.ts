// What the worker hands the engine for every turn and for the warm-up: the Anthropic client,
// the registry, the voice settings and a clock, turned into a `LoopConfig` for one caller. The
// system blocks are the static voice prompt (with the cache breakpoint), the per-user block and
// the date line; the warm-up sends the same blocks, so the first question hits the cache.
import type Anthropic from '@anthropic-ai/sdk'

import {
  type AuthContext,
  buildStaticSystemPrompt,
  buildUserContext,
  type ChannelSettings,
  dateLine,
  type LoopConfig,
  type ToolRegistry,
} from '@va/core'

export const LOG_TAG = '[voice]'

export interface VoiceDeps {
  anthropic: Anthropic
  registry: ToolRegistry
  settings: ChannelSettings
  clock: () => Date
}

export function voiceLoopConfig(deps: VoiceDeps, ctx: AuthContext): LoopConfig {
  return {
    anthropic: deps.anthropic,
    channel: 'voice',
    settings: deps.settings,
    system: [
      { type: 'text', text: buildStaticSystemPrompt('voice'), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: buildUserContext(ctx) },
      { type: 'text', text: dateLine(deps.clock()) },
    ],
    tools: deps.registry.anthropicTools(ctx, 'voice'),
    registry: deps.registry,
    logTag: LOG_TAG,
  }
}
