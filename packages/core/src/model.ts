// Model profiles: the request fields a model needs beyond the common ones, and the beta headers
// that go with them. Model ids and options live here and nowhere else (decision 0005).
//
// Never sent: `thinking: { type: 'disabled' }`, `budget_tokens`, `temperature`, a forced
// `tool_choice`, or an assistant prefill. `thinking` is omitted (adaptive) everywhere except
// `between_tools` on Sonnet 5.5 at effort ≤ high, which is the lowest thinking setting that
// model accepts. Server-side fallback (`fallbacks: 'default'`, beta
// `server-side-fallback-2026-07-01`) only where the API supports it: Opus 5.5 and Sonnet 5.5.
import type { ChannelSettings, Effort } from './channel.js'

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export interface ModelExtra {
  output_config: { effort: Effort }
  thinking?: { type: 'between_tools' }
  fallbacks?: 'default'
}

export interface ModelProfile {
  /** Spread into the Messages request after the common fields. */
  extra: ModelExtra
  /** Non-empty means the call goes through the beta Messages endpoint with these headers. */
  betas: string[]
}

const BETWEEN_TOOLS_EFFORTS: readonly Effort[] = ['low', 'medium', 'high']

export function modelProfile(settings: Pick<ChannelSettings, 'model' | 'effort' | 'thinking'>): ModelProfile {
  const extra: ModelExtra = { output_config: { effort: settings.effort } }
  switch (settings.model) {
    case 'claude-opus-5-5':
      extra.fallbacks = 'default'
      return { extra, betas: [FALLBACK_BETA] }
    case 'claude-sonnet-5-5':
      if (settings.thinking === 'between_tools' && BETWEEN_TOOLS_EFFORTS.includes(settings.effort)) {
        extra.thinking = { type: 'between_tools' }
      }
      extra.fallbacks = 'default'
      return { extra, betas: [FALLBACK_BETA] }
    default:
      // Haiku 5.5 has no fallback support; anything else gets nothing model-specific.
      return { extra, betas: [] }
  }
}
