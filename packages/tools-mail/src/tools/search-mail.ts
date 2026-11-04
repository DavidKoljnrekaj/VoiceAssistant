import { z } from 'zod'

import { defineTool } from '@va/core'

import { isAccessFailure, isSpoken, type MailDeps, withGraph } from '../access.js'
import { GraphError } from '../graph.js'
import { type GraphMessage, LIST_SELECT, listItem } from './messages.js'

const CHAT_MAX = 10
const VOICE_MAX = 5
const SEARCH_INVALID = {
  error: 'search_invalid',
  hint: 'Graph could not search for these words. Try fewer or plainer words.',
} as const

/** The user's words inside one pair of quotes for `$search`, with every quote and backslash
 * removed so nothing can close the quotes early (Graph would answer 400). Graph still reads KQL
 * words such as `from:` or `OR` inside them; that only narrows a search of the user's own mail.
 * `*` is refused by the schema. Empty once cleaned: null. */
export function kqlPhrase(query: string): string | null {
  const words = query.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? `"${words}"` : null
}

export function searchMail(deps: MailDeps) {
  return defineTool({
    name: 'search_mail',
    description:
      "Search all of the user's own Outlook mail (every folder) for words in the subject, body or sender, " +
      'newest matches first as Graph ranks them. Returns, per message, a short ref (m1, m2 …), the sender name, ' +
      'the subject, when it arrived (ISO, Europe/Zagreb) and a short preview. Call it when the user names a ' +
      'topic, a project or a sender ("the mail from Marko about the contract"). For simply the newest or ' +
      'unread messages use list_mail; for the full text of one result use read_mail with its ref. Wildcards ' +
      '(*) are not supported.',
    input: z.object({
      query: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[^*]*$/, 'must not contain *')
        .describe('Words to find, e.g. a sender name or a topic. Plain words only; no * wildcard.'),
      limit: z
        .int()
        .min(1)
        .max(CHAT_MAX)
        .default(CHAT_MAX)
        .describe('Maximum number of messages to return (at most 5 on a call).'),
    }),
    requiredRoles: ['admin', 'member'],
    readOnly: true,
    async handler(input, ctx, extras, signal) {
      const spoken = isSpoken(extras.channel)
      const top = Math.min(input.limit ?? CHAT_MAX, spoken ? VOICE_MAX : CHAT_MAX)
      const phrase = kqlPhrase(input.query)
      if (!phrase) return SEARCH_INVALID
      let result
      try {
        result = await withGraph(deps, ctx, signal, (graph) =>
          graph.get<{ value: GraphMessage[] }>('/me/messages', {
            select: LIST_SELECT,
            query: { $search: phrase, $top: top },
            signal,
          }),
        )
      } catch (e) {
        if (e instanceof GraphError && e.kind === 'bad_request') return SEARCH_INVALID
        throw e
      }
      if (isAccessFailure(result)) return result
      const messages = result.value.slice(0, top).map((m) => listItem(m, ctx.userId, deps.refs, spoken))
      return { count: messages.length, messages }
    },
  })
}
