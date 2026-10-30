// The demo pack against the fakes, as the user: the handlers, the strict schemas, the allowlist,
// and two scenarios through the real loop (D10, D11).
import { describe, expect, it } from 'vitest'

import { type ChannelAllowlist, toAnthropicTool, ToolRegistry, type ToolHandlerExtras } from '@va/core'
import {
  anthropic,
  answer,
  authAs,
  callTools,
  clientOf,
  db,
  ITEMS,
  reset,
  runChat,
  scenario,
  toolUse,
  USERS,
} from '@va/core/test'

import { demoPack, createNote, getItem, searchItems } from './index.js'

/** As the apps compose the pack: everything on chat, the two reads on voice. */
const ALLOWLIST: ChannelAllowlist = { chat: 'all', voice: ['search_items', 'get_item'] }
const extras: ToolHandlerExtras = { requestId: 'req-test', channel: 'chat' }
const voice: ToolHandlerExtras = { requestId: 'req-test', channel: 'voice' }
const signal = new AbortController().signal

describe('@va/tools-demo', () => {
  it('D01: the registry accepts the pack with the apps’ allowlist; voice gets the two reads', () => {
    const registry = new ToolRegistry([demoPack], ALLOWLIST)
    expect(registry.select({ role: 'member' }, 'chat').map((t) => t.name)).toEqual([
      'create_note',
      'get_item',
      'search_items',
    ])
    expect(registry.select({ role: 'member' }, 'voice').map((t) => t.name)).toEqual(['get_item', 'search_items'])
    expect(registry.find({ role: 'admin' }, 'create_note', 'voice')).toBeUndefined()
  })

  it('D02: every tool is strict with a described property on every field', () => {
    for (const def of demoPack.tools) {
      const tool = toAnthropicTool(def)
      expect(tool.strict).toBe(true)
      expect(tool.input_schema.additionalProperties).toBe(false)
      const properties = tool.input_schema.properties as Record<string, { description?: string }>
      for (const [key, prop] of Object.entries(properties)) {
        expect(prop.description, `${def.name}.${key}`).toBeTruthy()
      }
    }
  })

  it('D03: search_items reads as the user, sorts, and applies the default limit', async () => {
    reset()
    const ctx = await authAs('member')
    const input = searchItems.input.parse({ query: 'STOL' })
    expect(input.limit).toBe(20)
    const result = (await searchItems.handler(input, ctx, extras, signal)) as {
      items: { name: string }[]
      total: number
    }
    expect(result.total).toBe(3)
    expect(result.items.map((i) => i.name)).toEqual(['Radni stol', 'Stolna lampa', 'Uredska stolica'])
    expect(result.items[0]).toHaveProperty('id')
    expect(result.items[0]).not.toHaveProperty('description')
    const req = db.requestsTo('demo_items', 'GET').at(-1)!
    expect(clientOf(req)).toBe('user')
    expect(req.params.get('limit')).toBe('20')
    expect(req.params.get('order')).toBe('name.asc')
  })

  it('D07: % and _ in the query are literal; * is refused by the schema', async () => {
    reset()
    const ctx = await authAs('admin')
    const percent = (await searchItems.handler({ query: '100%', limit: 20 }, ctx, extras, signal)) as {
      items: { name: string }[]
    }
    expect(percent.items.map((i) => i.name)).toEqual(['Kupon 100% popusta'])
    expect(db.requestsTo('demo_items', 'GET').at(-1)!.params.get('name')).toBe('ilike.%100\\%%')
    const underscore = (await searchItems.handler({ query: '1_5', limit: 20 }, ctx, extras, signal)) as {
      items: { name: string }[]
    }
    expect(underscore.items.map((i) => i.name)).toEqual(['Kabel 1_5 m'])
    expect(searchItems.input.safeParse({ query: 'kabel*' }).success).toBe(false)
    expect(searchItems.input.safeParse({ query: '*' }).success).toBe(false)
  })

  it('D08: the limit is applied in the query and capped at 100 even for unparsed input', async () => {
    reset()
    const ctx = await authAs('admin')
    const two = (await searchItems.handler({ query: 'a', limit: 2 }, ctx, extras, signal)) as {
      items: unknown[]
      total: number
    }
    expect(two.items).toHaveLength(2)
    expect(two.total).toBe(8)
    expect(db.requestsTo('demo_items', 'GET').at(-1)!.params.get('limit')).toBe('2')
    await searchItems.handler({ query: 'a', limit: 1000 }, ctx, extras, signal)
    expect(db.requestsTo('demo_items', 'GET').at(-1)!.params.get('limit')).toBe('100')
    expect(searchItems.input.safeParse({ query: 'a', limit: 1000 }).success).toBe(false)
  })

  it('D09: on voice, search_items returns at most five items without ids or timestamps, and get_item no id', async () => {
    reset()
    const ctx = await authAs('member')
    const result = (await searchItems.handler({ query: 'a', limit: 20 }, ctx, voice, signal)) as {
      items: Record<string, unknown>[]
      total: number
    }
    expect(result.items).toHaveLength(5)
    expect(result.total).toBe(8)
    expect(db.requestsTo('demo_items', 'GET').at(-1)!.params.get('limit')).toBe('5')
    for (const item of result.items) expect(Object.keys(item).sort()).toEqual(['category', 'name', 'price'])
    const item = (await getItem.handler({ item_id: ITEMS.lamp.id }, ctx, voice, signal)) as Record<
      string,
      unknown
    >
    expect(Object.keys(item).sort()).toEqual(['category', 'description', 'name', 'price'])
    expect(item.description).toBe('Opis: Stolna lampa')
  })

  it('D04: get_item returns the item, or an error envelope when the id is unknown', async () => {
    reset()
    const ctx = await authAs('admin')
    const found = await getItem.handler({ item_id: ITEMS.laptop.id }, ctx, extras, signal)
    expect(found).toMatchObject({ id: ITEMS.laptop.id, name: ITEMS.laptop.name, price: 1299 })
    const missing = await getItem.handler(
      { item_id: '00000000-0000-4000-8000-000000000999' },
      ctx,
      extras,
      signal,
    )
    expect(missing).toEqual({ error: 'item not found' })
    expect(() => getItem.input.parse({ item_id: 'not-a-uuid' })).toThrow()
  })

  it('D05: create_note writes through the user client with the caller’s user_id', async () => {
    reset()
    const ctx = await authAs('member')
    const result = (await createNote.handler(
      { item_id: ITEMS.desk.id, text: ' Naručiti dva. ' },
      ctx,
      extras,
      signal,
    )) as {
      id: string
    }
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/)
    const req = db.requestsTo('demo_notes', 'POST')[0]!
    expect(clientOf(req)).toBe('user')
    expect(req.body).toEqual({ user_id: USERS.member.id, item_id: ITEMS.desk.id, text: ' Naručiti dva. ' })
    expect(createNote.input.parse({ item_id: ITEMS.desk.id, text: ' Naručiti dva. ' }).text).toBe(
      'Naručiti dva.',
    )
  })

  it('D06: a failing read throws instead of returning an empty list', async () => {
    reset()
    const ctx = await authAs('member')
    db.fault((r) => r.table === 'demo_items', { status: 500 })
    await expect(searchItems.handler({ query: 'x', limit: 20 }, ctx, extras, signal)).rejects.toThrow(
      /search_items failed/,
    )
  })

  scenario(
    'D10 through the loop: search_items runs as the user, its result reaches the model and the tool_result row',
    async () => {
      anthropic.script(callTools(toolUse('search_items', { query: 'stol' })), answer('Tri stavke.'))
      const ctx = await authAs('member')
      const run = await runChat(ctx, 'Koji stolovi postoje?', {
        packs: [demoPack],
        allowlist: ALLOWLIST,
      })
      expect(anthropic.calls[0]!.body.tools!.map((t) => t.name)).toEqual([
        'create_note',
        'get_item',
        'search_items',
      ])
      const result = run.sink.toolResults[0]!.output as { items: { name: string }[]; total: number }
      expect(run.sink.toolResults[0]!.isError).toBe(false)
      expect(result.total).toBe(3)
      expect(result.items.map((i) => i.name)).toEqual(['Radni stol', 'Stolna lampa', 'Uredska stolica'])
      expect(clientOf(db.requestsTo('demo_items', 'GET')[0]!)).toBe('user')
      expect(run.rows().map((r) => r.turn_kind)).toEqual(['user', 'assistant', 'tool_result', 'assistant'])
      expect(run.sink.doneEvent?.stopReason).toBe('end_turn')
    },
  )

  scenario(
    'D11 through the loop on voice: create_note is not advertised and is refused at dispatch',
    async () => {
      anthropic.script(
        callTools(toolUse('create_note', { item_id: ITEMS.lamp.id, text: 'x' })),
        answer('Ne mogu.'),
      )
      const ctx = await authAs('admin')
      const run = await runChat(ctx, 'Zabilježi nešto', {
        channel: 'voice',
        packs: [demoPack],
        allowlist: ALLOWLIST,
      })
      expect(anthropic.calls[0]!.body.tools!.map((t) => t.name)).toEqual(['get_item', 'search_items'])
      expect(run.sink.toolResults[0]!.output).toEqual({
        error: expect.stringMatching(/not_permitted_on_channel/),
      })
      expect(db.rows('demo_notes')).toHaveLength(0)
    },
  )
})
