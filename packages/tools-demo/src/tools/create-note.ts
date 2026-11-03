import { z } from 'zod'

import { defineTool } from '@va/core'

import { demoClient } from '../demo-db.js'

/** A write tool under the write protocol (Part 12): it previews, the user confirms, then it
 * writes. `readOnly: false` with `confirmation: 'required'` is what lets a spoken channel name
 * it later; chat offers it to every role. */
export const createNote = defineTool({
  name: 'create_note',
  description:
    'Attach a short note, written by the user, to a demo catalogue item. Call it only when the user ' +
    'explicitly asks to note or remember something about an item they have named; never to store your ' +
    'own summaries. Needs the item id from search_items. The user is asked to confirm before the note ' +
    'is written: the first call returns what would be written; once the user has confirmed, call it ' +
    'again with exactly the same item_id and text. Returns the id of the new note.',
  input: z.object({
    item_id: z.uuid().describe('The item the note is about, from search_items.'),
    text: z.string().trim().min(1).max(2000).describe('The note, in the user’s words.'),
  }),
  requiredRoles: ['admin', 'member'],
  readOnly: false,
  confirmation: 'required',
  /** <!-- needs native review --> */
  async preview(input, ctx, _extras, signal) {
    const { data, error } = await demoClient(ctx)
      .from('demo_items')
      .select('name')
      .eq('id', input.item_id)
      .abortSignal(signal)
      .maybeSingle()
    if (error) throw new Error(`create_note preview failed: ${error.code}`)
    if (!data) throw new Error('item not found')
    return `Zabilježit ću uz artikl "${data.name}": "${input.text}"`
  },
  async handler(input, ctx, _extras, signal) {
    const { data, error } = await demoClient(ctx)
      .from('demo_notes')
      .insert({ user_id: ctx.userId, item_id: input.item_id, text: input.text })
      .select('id, created_at')
      .abortSignal(signal)
      .single()
    if (error) throw new Error(`create_note failed: ${error.code}`)
    return data
  },
})
