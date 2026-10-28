import { z } from 'zod'

import { defineTool } from '@va/core'

import { demoClient } from '../demo-db.js'

/** A write tool. It exists to prove the voice allowlist refuses what writes: `readOnly: false`
 * keeps it off voice at registry construction, and chat offers it to every role. */
export const createNote = defineTool({
  name: 'create_note',
  description:
    'Attach a short note, written by the user, to a demo catalogue item. Call it only when the user ' +
    'explicitly asks to note or remember something about an item they have named; never to store your ' +
    'own summaries. Needs the item id from search_items. Returns the id of the new note.',
  input: z.object({
    item_id: z.uuid().describe('The item the note is about, from search_items.'),
    text: z.string().trim().min(1).max(2000).describe('The note, in the user’s words.'),
  }),
  requiredRoles: ['admin', 'member'],
  readOnly: false,
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
