// M scenarios: the profile table in docs/plan/03-core-engine.md §4, one case per row.
import { describe, expect, it } from 'vitest'

import { CHANNEL_DEFAULTS } from './channel.js'
import { FALLBACK_BETA, modelProfile } from './model.js'

describe('modelProfile', () => {
  it('M01: Opus 5.5 omits thinking, sends effort and fallbacks default with the beta header', () => {
    expect(modelProfile(CHANNEL_DEFAULTS.chat)).toEqual({
      extra: { output_config: { effort: 'medium' }, fallbacks: 'default' },
      betas: [FALLBACK_BETA],
    })
    expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01')
  })

  it('M02: Sonnet 5.5 with between_tools at effort ≤ high sends it, plus fallbacks and the beta', () => {
    expect(modelProfile(CHANNEL_DEFAULTS.voice)).toEqual({
      extra: { output_config: { effort: 'low' }, thinking: { type: 'between_tools' }, fallbacks: 'default' },
      betas: [FALLBACK_BETA],
    })
    expect(
      modelProfile({ model: 'claude-sonnet-5-5', effort: 'high', thinking: 'between_tools' }).extra.thinking,
    ).toEqual({
      type: 'between_tools',
    })
  })

  it('M03: Sonnet 5.5 with adaptive thinking omits the thinking parameter', () => {
    const { extra } = modelProfile({ model: 'claude-sonnet-5-5', effort: 'medium', thinking: 'adaptive' })
    expect(extra).toEqual({ output_config: { effort: 'medium' }, fallbacks: 'default' })
  })

  it('M04: Haiku 5.5 gets effort only: no fallbacks, no betas', () => {
    expect(modelProfile({ model: 'claude-haiku-5-5', effort: 'low', thinking: 'between_tools' })).toEqual({
      extra: { output_config: { effort: 'low' } },
      betas: [],
    })
  })

  it('M05: any other model gets effort only', () => {
    expect(modelProfile({ model: 'claude-opus-4-8', effort: 'high', thinking: 'adaptive' })).toEqual({
      extra: { output_config: { effort: 'high' } },
      betas: [],
    })
  })

  it('M06: never sends thinking disabled, budget_tokens, temperature, tool_choice or a prefill', () => {
    for (const settings of [
      CHANNEL_DEFAULTS.chat,
      CHANNEL_DEFAULTS.voice,
      { model: 'claude-haiku-5-5', effort: 'low', thinking: 'between_tools' } as const,
      { model: 'something-else', effort: 'high', thinking: 'between_tools' } as const,
    ]) {
      const { extra } = modelProfile(settings)
      const flat = JSON.stringify(extra)
      expect(flat).not.toMatch(/disabled|budget_tokens|temperature|tool_choice|top_p|top_k|display/)
      expect(Object.keys(extra).sort()).toEqual(
        Object.keys(extra)
          .filter((k) => ['output_config', 'thinking', 'fallbacks'].includes(k))
          .sort(),
      )
    }
  })
})
