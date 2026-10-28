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

/** `Danas je …` for the Europe/Zagreb day of `now`: the third, uncached system block. The same
 * line the API sends; the prompt builders in @va/core read no clock. */
export function dateLine(now: Date): string {
  // hr-HR renders "srijeda, 28. listopada 2026." with its own full stop.
  const day = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', dateStyle: 'full' }).format(now)
  return `Danas je ${day.replace(/\.$/, '')}.`
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
