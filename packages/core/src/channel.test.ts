import { describe, expect, it } from 'vitest'

import { CHANNEL_DEFAULTS, channelSettings } from './channel.js'

describe('channelSettings', () => {
  it('C01: chat and voice defaults are the brief’s table', () => {
    expect(CHANNEL_DEFAULTS.chat).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'medium',
      thinking: 'adaptive',
      maxTokens: 8192,
      maxIterations: 10,
      toolTimeoutMs: 15_000,
      requestTimeoutMs: 90_000,
    })
    expect(CHANNEL_DEFAULTS.voice).toMatchObject({
      model: 'claude-sonnet-5-5',
      effort: 'low',
      thinking: 'between_tools',
      maxTokens: 1024,
      maxIterations: 4,
      toolTimeoutMs: 6_000,
      requestTimeoutMs: 25_000,
    })
  })

  it('C02: env overrides model and effort per channel, empty values keep the default', () => {
    const env = { AI_CHAT_MODEL: 'claude-haiku-5-5', AI_CHAT_EFFORT: 'high', AI_VOICE_EFFORT: '' }
    expect(channelSettings('chat', env)).toMatchObject({ model: 'claude-haiku-5-5', effort: 'high' })
    expect(channelSettings('voice', env)).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low' })
  })

  it('C03: an invalid effort throws, naming the variable and not the value', () => {
    expect(() => channelSettings('voice', { AI_VOICE_EFFORT: 'xhigh' })).toThrow(/AI_VOICE_EFFORT/)
    expect(() => channelSettings('voice', { AI_VOICE_EFFORT: 'xhigh' })).not.toThrow(/xhigh/)
  })

  it('C04: returns a copy; callers cannot mutate the defaults', () => {
    const s = channelSettings('chat', {})
    s.maxTokens = 1
    expect(CHANNEL_DEFAULTS.chat.maxTokens).toBe(8192)
  })
})
