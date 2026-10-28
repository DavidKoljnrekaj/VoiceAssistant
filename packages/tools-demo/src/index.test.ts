// The demo pack against the fakes, as the user. The scenario tests through the loop (E04, E06,
// E08, E09) arrive with Part 3b; these pin the handlers, the strict schemas and the allowlist.
import { describe, expect, it } from 'vitest'

import { CHANNEL_ALLOWLIST, toAnthropicTool, ToolRegistry, type ToolHandlerExtras } from '@va/core'
import { authAs, clientOf, db, ITEMS, reset, USERS } from '@va/core/test'

import { demoPack, createNote, getItem, searchItems } from './index.js'

const extras: ToolHandlerExtras = { requestId: 'req-test', channel: 'chat' }
const voice: ToolHandlerExtras = { requestId: 'req-test', channel: 'voice' }
const signal = new AbortController().signal

describe('@va/tools-demo', () => {
  it('D01: the registry accepts the pack with the default allowlist; voice gets the two reads', () => {
    const registry = new ToolRegistry([demoPack])
    expect(registry.select({ role: 'member' }, 'chat').map((t) => t.name)).toEqual([
      'create_note',
      'get_item',
      'search_items',
    ])
    expect(registry.select({ role: 'member' }, 'voice').map((t) => t.name)).toEqual(
      [...CHANNEL_ALLOWLIST.voice].sort(),
    )
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
})
