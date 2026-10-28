import { describe, expect, it } from 'vitest'

import {
  buildStaticSystemPrompt,
  buildUserContext,
  CHAT_INTRO_HR,
  CHAT_PRESENTATION_HR,
  DOMAIN_RULES_HR,
  VOICE_INTRO_HR,
  VOICE_PRESENTATION_HR,
} from './index.js'

describe('prompts', () => {
  it('P01: the static prompt is intro + domain rules + presentation, per channel', () => {
    expect(buildStaticSystemPrompt('chat')).toBe(
      `${CHAT_INTRO_HR}\n\n${DOMAIN_RULES_HR}\n\n${CHAT_PRESENTATION_HR}`,
    )
    expect(buildStaticSystemPrompt('voice')).toBe(
      `${VOICE_INTRO_HR}\n\n${DOMAIN_RULES_HR}\n\n${VOICE_PRESENTATION_HR}`,
    )
  })

  it('P02: byte-identical across calls and time, and different per channel', () => {
    const a = buildStaticSystemPrompt('chat')
    const b = buildStaticSystemPrompt('chat')
    expect(a).toBe(b)
    expect(a).not.toBe(buildStaticSystemPrompt('voice'))
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}|Danas je/)
  })

  it('P03: the domain rules are one constant shared by both channels and carry no Landmark domain', () => {
    expect(buildStaticSystemPrompt('chat')).toContain(DOMAIN_RULES_HR)
    expect(buildStaticSystemPrompt('voice')).toContain(DOMAIN_RULES_HR)
    expect(DOMAIN_RULES_HR).not.toMatch(/TIC|cesij|račun|Cognilion/i)
    expect(buildStaticSystemPrompt('voice')).not.toContain('Cognilion')
  })

  it('P04: the user context names the user and role; members get the scope sentence', () => {
    expect(buildUserContext({ email: 'ana@va.test', role: 'admin' })).toBe(
      '## Korisnik\nKorisnik: ana@va.test, uloga: admin.',
    )
    const member = buildUserContext({ email: null, role: 'member' })
    expect(member).toMatch(/^## Korisnik\nKorisnik: nepoznat korisnik, uloga: member\. /)
    expect(member.split('\n')).toHaveLength(2)
  })
})
