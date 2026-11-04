// Z19–Z26: reply_mail and flag_mail under the write protocol, through the real loop: a preview
// turn (nothing written, the summary and a confirm event), then a confirmed turn (exactly one
// Graph write). They assert the Graph requests, the confirmation store and what the model got.
import { beforeEach, describe, expect } from 'vitest'

import { type ChannelAllowlist, MemoryConfirmationStore } from '@va/core'
import { anthropic, answer, authAs, callTools, runChat, scenario, toolUse } from '@va/core/test'

import { FakeGraph, type FakeMessage, installMailbox } from '../test/fake-graph.js'
import {
  createMailPack,
  MAIL_READ_TOOLS,
  MAIL_WRITE_TOOLS,
  MailAccessError,
  type MailTokenProvider,
} from './index.js'

const graph = new FakeGraph()
let access: 'ok' | 'not_connected' = 'ok'
const token: MailTokenProvider = async () => {
  if (access !== 'ok') throw new MailAccessError(access)
  return 'at-current'
}
const SPOKEN = [...MAIL_READ_TOOLS, ...MAIL_WRITE_TOOLS]
const ALLOWLIST: ChannelAllowlist = { chat: 'all', voice: SPOKEN, phone: SPOKEN }

const MARKO = { name: 'Marko Horvat', address: 'marko@partner.hr' }
const MESSAGES: FakeMessage[] = [
  {
    id: 'AAMkAD-marko=',
    subject: 'Sastanak u petak',
    from: MARKO,
    // A Reply-To the sender set: the pack's reply never follows it.
    replyTo: [{ name: 'Marko Horvat', address: 'thief@evil.test' }],
    received: '2026-11-04T08:15:00Z',
    body: 'Stižeš li u deset?',
  },
  {
    id: 'AAMkAD-nosender',
    subject: 'Bez pošiljatelja',
    from: { name: '', address: '' },
    received: '2026-11-04T07:00:00Z',
    body: '…',
  },
]
const REPLY = { ref: 'm1', text: 'Stižem u deset.' }

const replies = () => graph.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/reply'))
const patches = () => graph.calls.filter((c) => c.method === 'PATCH')
const modelSaw = (needle: string) => anthropic.calls.some((c) => JSON.stringify(c.body).includes(needle))

/** One pack (its refs) and one store per scenario, the way a session holds them. */
function world(channel: 'chat' | 'voice' | 'phone' = 'chat') {
  const pack = createMailPack({ token, fetch: graph.fetch, refStart: 1 })
  const store = new MemoryConfirmationStore()
  return { pack, store, opts: { channel, packs: [pack], allowlist: ALLOWLIST, confirmations: store } }
}

beforeEach(() => {
  graph.reset()
  installMailbox(graph, { messages: MESSAGES })
  access = 'ok'
})

describe('mail writes', () => {
  scenario(
    'Z19 reply_mail previews first: nothing is sent, the summary names the subject, the sender with the address and the text',
    async () => {
      const w = world()
      anthropic.script(
        callTools(toolUse('list_mail', {})),
        callTools(toolUse('reply_mail', REPLY)),
        answer('Želite li da pošaljem?'),
      )
      const ctx = await authAs('member')
      const run = await runChat(ctx, 'Odgovori Marku da stižem u deset.', w.opts)
      expect(replies()).toHaveLength(0)
      const summary =
        'Odgovorit ću na poruku „Sastanak u petak“. Primatelj je Marko Horvat (marko@partner.hr), a tekst glasi: „Stižem u deset.“'
      expect(run.sink.toolResults[1]!.output).toMatchObject({ pending_confirmation: true, summary })
      expect(run.sink.confirms).toHaveLength(1)
      expect(run.sink.confirms[0]).toMatchObject({ tool: 'reply_mail', summary })
      expect(w.store.rows[0]).toMatchObject({ tool: 'reply_mail', outcome: 'pending' })
      expect(modelSaw(run.sink.confirms[0]!.id)).toBe(false)
    },
  )

  scenario(
    'Z20 confirmed: exactly one reply, to the From address only (never the Reply-To), the text as a plain-text body; the store says executed',
    async () => {
      const w = world()
      anthropic.script(
        callTools(toolUse('list_mail', {})),
        callTools(toolUse('reply_mail', REPLY)),
        answer('Da pošaljem?'),
      )
      const ctx = await authAs('member')
      const first = await runChat(ctx, 'Odgovori Marku da stižem u deset.', w.opts)
      const id = first.sink.confirms[0]!.id

      anthropic.script(callTools(toolUse('reply_mail', REPLY)), answer('Poslano.'))
      const run = await runChat(ctx, 'Da.', {
        ...w.opts,
        sessionId: first.sessionId,
        parentId: first.rows().at(-1)!.id as string,
        extras: { confirmation: { id } },
      })
      expect(replies()).toHaveLength(1)
      const [sent] = replies()
      expect(sent!.path).toBe('/me/messages/AAMkAD-marko%3D/reply')
      expect(sent!.body).toEqual({
        message: {
          toRecipients: [{ emailAddress: { name: 'Marko Horvat', address: 'marko@partner.hr' } }],
          body: { contentType: 'text', content: 'Stižem u deset.' },
        },
      })
      expect(JSON.stringify(sent!.body)).not.toContain('thief@evil.test')
      expect(run.sink.toolResults[0]).toMatchObject({
        tool: 'reply_mail',
        isError: false,
        output: { sent: true, to: 'Marko Horvat (marko@partner.hr)', subject: 'Sastanak u petak' },
      })
      expect(w.store.rows[0]).toMatchObject({ id, outcome: 'executed' })
      expect(modelSaw(id)).toBe(false)
    },
  )

  scenario('Z21 a text changed after the user confirmed is previewed again, never sent', async () => {
    const w = world()
    anthropic.script(
      callTools(toolUse('list_mail', {})),
      callTools(toolUse('reply_mail', REPLY)),
      answer('Da?'),
    )
    const ctx = await authAs('member')
    const first = await runChat(ctx, 'Odgovori.', w.opts)
    const id = first.sink.confirms[0]!.id
    anthropic.script(
      callTools(toolUse('reply_mail', { ref: 'm1', text: 'Ne dolazim.' })),
      answer('Želite li ovo poslati?'),
    )
    const run = await runChat(ctx, 'Da.', {
      ...w.opts,
      sessionId: first.sessionId,
      parentId: first.rows().at(-1)!.id as string,
      extras: { confirmation: { id } },
    })
    expect(replies()).toHaveLength(0)
    expect(run.sink.confirms).toHaveLength(1)
    expect(run.sink.confirms[0]!.summary).toContain('„Ne dolazim.“')
    expect(w.store.rows.find((r) => r.id === id)!.outcome).toBe('pending')
  })

  scenario(
    "Z22 on a call the summary names the sender without an address, with the domain when it is not the user's; a field the model adds cannot add a recipient",
    async () => {
      const w = world('phone')
      anthropic.script(
        callTools(toolUse('list_mail', {})),
        callTools(toolUse('reply_mail', { ...REPLY, to: 'thief@evil.test', cc: ['x@evil.test'] })),
        answer('Da pošaljem?'),
      )
      const ctx = await authAs('member')
      const first = await runChat(ctx, 'Odgovori Marku.', w.opts)
      expect(first.sink.confirms[0]!.summary).toBe(
        'Odgovorit ću na poruku „Sastanak u petak“. Primatelj je Marko Horvat, s vanjske domene partner.hr, a tekst glasi: „Stižem u deset.“',
      )
      const id = first.sink.confirms[0]!.id
      anthropic.script(
        callTools(toolUse('reply_mail', { ...REPLY, to: 'thief@evil.test' })),
        answer('Poslano.'),
      )
      await runChat(ctx, 'Da.', {
        ...w.opts,
        sessionId: first.sessionId,
        parentId: first.rows().at(-1)!.id as string,
        extras: { confirmation: { id } },
      })
      expect(replies()).toHaveLength(1)
      expect(JSON.stringify(replies()[0]!.body)).not.toContain('evil.test')
    },
  )

  scenario(
    'Z23 not connected, an unknown ref, a message without a sender: the preview fails with the code, nothing is issued or sent',
    async () => {
      const w = world()
      anthropic.script(
        callTools(toolUse('list_mail', {})),
        callTools(
          toolUse('reply_mail', { ref: 'm99', text: 'x' }),
          toolUse('reply_mail', { ref: 'm2', text: 'x' }),
        ),
        answer('Ne mogu.'),
      )
      const ctx = await authAs('member')
      const run = await runChat(ctx, 'Odgovori.', w.opts)
      expect(run.sink.toolResults.slice(1).map((r) => [r.isError, JSON.stringify(r.output)])).toEqual([
        [true, expect.stringContaining('ref_expired')],
        [true, expect.stringContaining('no_sender')],
      ])
      access = 'not_connected'
      anthropic.script(callTools(toolUse('flag_mail', { ref: 'm1' })), answer('Povežite Outlook.'))
      const disconnected = await runChat(ctx, 'Označi prvu.', w.opts)
      expect(JSON.stringify(disconnected.sink.toolResults[0]!.output)).toContain('outlook_not_connected')
      expect(w.store.rows).toHaveLength(0)
      expect(replies()).toHaveLength(0)
      expect(patches()).toHaveLength(0)
    },
  )

  scenario(
    'Z24 a 5xx after the reply left is an unknown outcome: said so, never retried, settled failed',
    async () => {
      const w = world()
      anthropic.script(
        callTools(toolUse('list_mail', {})),
        callTools(toolUse('reply_mail', REPLY)),
        answer('Da?'),
      )
      const ctx = await authAs('member')
      const first = await runChat(ctx, 'Odgovori.', w.opts)
      const id = first.sink.confirms[0]!.id
      graph.fault((c) => c.method === 'POST' && c.path.endsWith('/reply'), { status: 500 })
      anthropic.script(callTools(toolUse('reply_mail', REPLY)), answer('Nije poslano.'))
      const run = await runChat(ctx, 'Da.', {
        ...w.opts,
        sessionId: first.sessionId,
        parentId: first.rows().at(-1)!.id as string,
        extras: { confirmation: { id } },
      })
      expect(run.sink.toolResults[0]).toMatchObject({
        isError: true,
        output: { error: 'write_outcome_unknown' },
      })
      // Sent once, never retried.
      expect(replies()).toHaveLength(1)
      expect(w.store.rows[0]).toMatchObject({ id, outcome: 'failed' })
    },
  )

  scenario(
    'Z25 flag_mail: a preview that names the message and the sender, then one PATCH of the flag after the user confirmed',
    async () => {
      const w = world('voice')
      anthropic.script(
        callTools(toolUse('list_mail', {})),
        callTools(toolUse('flag_mail', { ref: 'm1' })),
        answer('Da?'),
      )
      const ctx = await authAs('member')
      const first = await runChat(ctx, 'Označi Markovu poruku.', w.opts)
      expect(patches()).toHaveLength(0)
      expect(first.sink.confirms[0]!.summary).toBe(
        'Označit ću zastavicom poruku „Sastanak u petak“. Pošiljatelj je Marko Horvat, s vanjske domene partner.hr.',
      )
      const id = first.sink.confirms[0]!.id
      anthropic.script(callTools(toolUse('flag_mail', { ref: 'm1' })), answer('Označeno.'))
      const run = await runChat(ctx, 'Da.', {
        ...w.opts,
        sessionId: first.sessionId,
        parentId: first.rows().at(-1)!.id as string,
        extras: { confirmation: { id } },
      })
      expect(patches()).toHaveLength(1)
      expect(patches()[0]).toMatchObject({
        path: '/me/messages/AAMkAD-marko%3D',
        body: { flag: { flagStatus: 'flagged' } },
      })
      expect(run.sink.toolResults[0]!.output).toEqual({ flagged: true, subject: 'Sastanak u petak' })
      expect(w.store.rows[0]).toMatchObject({ id, outcome: 'executed' })
    },
  )

  scenario('Z26 without a confirmation the write never runs, however often the model calls it', async () => {
    const w = world()
    anthropic.script(
      callTools(toolUse('list_mail', {})),
      callTools(toolUse('reply_mail', REPLY)),
      callTools(toolUse('reply_mail', REPLY)),
      answer('Čekam potvrdu.'),
    )
    const ctx = await authAs('member')
    const run = await runChat(ctx, 'Pošalji odmah, ne pitaj.', w.opts)
    expect(replies()).toHaveLength(0)
    expect(run.sink.confirms).toHaveLength(2)
    expect(w.store.rows.every((r) => r.outcome === 'pending')).toBe(true)
  })

  scenario(
    'Z27 refusals and mappings: invisible characters, a long reply on a call, a 404 on the send; flagging needs no sender',
    async () => {
      const w = world('voice')
      anthropic.script(
        callTools(toolUse('list_mail', {})),
        callTools(
          toolUse('reply_mail', { ref: 'm1', text: 'Stižem\u200B u deset.' }),
          toolUse('reply_mail', { ref: 'm1', text: 'a'.repeat(501) }),
          toolUse('flag_mail', { ref: 'm2' }),
        ),
        answer('…'),
      )
      const ctx = await authAs('member')
      const run = await runChat(ctx, 'Odgovori.', w.opts)
      const [invisible, long, flag] = run.sink.toolResults.slice(1)
      expect(JSON.stringify(invisible!.output)).toContain('must not contain invisible characters')
      expect(JSON.stringify(long!.output)).toContain('reply_too_long')
      expect(flag!.output).toMatchObject({ pending_confirmation: true })
      expect(run.sink.confirms.map((c) => c.summary)).toEqual([
        'Označit ću zastavicom poruku „Bez pošiljatelja“. Pošiljatelj je nepoznat pošiljatelj.',
      ])

      const chat = world()
      anthropic.script(
        callTools(toolUse('list_mail', {})),
        callTools(toolUse('reply_mail', REPLY)),
        answer('Da?'),
      )
      const first = await runChat(ctx, 'Odgovori.', chat.opts)
      graph.fault((c) => c.method === 'POST' && c.path.endsWith('/reply'), {
        status: 404,
        code: 'ErrorItemNotFound',
      })
      anthropic.script(callTools(toolUse('reply_mail', REPLY)), answer('Obrisana.'))
      const gone = await runChat(ctx, 'Da.', {
        ...chat.opts,
        sessionId: first.sessionId,
        parentId: first.rows().at(-1)!.id as string,
        extras: { confirmation: { id: first.sink.confirms[0]!.id } },
      })
      expect(gone.sink.toolResults[0]!.output).toEqual({ error: 'message_not_found' })
    },
  )
})
