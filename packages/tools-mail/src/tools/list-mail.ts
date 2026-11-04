import { z } from 'zod'

import { defineTool } from '@va/core'

import { isAccessFailure, isSpoken, type MailDeps, withGraph } from '../access.js'
import { type GraphMessage, LIST_SELECT, listItem } from './messages.js'

const CHAT_MAX = 20
const VOICE_MAX = 5
// Graph refuses $orderby on a property $filter does not lead with ("InefficientFilter"), so an
// unread filter starts with an always-true condition on receivedDateTime.
const UNREAD = 'receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false'

export function listMail(deps: MailDeps) {
  return defineTool({
    name: 'list_mail',
    description:
      "List the newest messages in the user's own Outlook inbox, unread only by default, newest first. " +
      'Returns the inbox unread count and, per message, a short ref (m1, m2 …), the sender name, the subject, ' +
      'when it arrived (ISO, Europe/Zagreb) and a short preview. Call it for "do I have new mail", a catch-up, ' +
      'or to get the ref of a message the user describes by sender or recency. Use read_mail with a ref for ' +
      'the full text, search_mail for a topic or a sender further back, list_calendar for meetings. Never call ' +
      "it to read someone else's mailbox: it only reads the signed-in user's own.",
    input: z.object({
      unread_only: z
        .boolean()
        .default(true)
        .describe('Only unread messages (the default). False lists read and unread together.'),
      limit: z
        .int()
        .min(1)
        .max(CHAT_MAX)
        .default(10)
        .describe('Maximum number of messages to return (at most 5 on a call).'),
    }),
    requiredRoles: ['admin', 'member'],
    readOnly: true,
    async handler(input, ctx, extras, signal) {
      const spoken = isSpoken(extras.channel)
      const top = Math.min(input.limit ?? 10, spoken ? VOICE_MAX : CHAT_MAX)
      const unreadOnly = input.unread_only ?? true
      const result = await withGraph(deps, ctx, signal, (graph) =>
        Promise.all([
          graph.get<{ value: GraphMessage[] }>('/me/mailFolders/inbox/messages', {
            select: LIST_SELECT,
            query: {
              $top: top,
              $orderby: 'receivedDateTime desc',
              ...(unreadOnly ? { $filter: UNREAD } : {}),
            },
            signal,
          }),
          graph.get<{ unreadItemCount: number }>('/me/mailFolders/inbox', {
            select: ['unreadItemCount'],
            signal,
          }),
        ]),
      )
      if (isAccessFailure(result)) return result
      const [messages, inbox] = result
      return {
        unread_count: inbox.unreadItemCount,
        messages: messages.value.slice(0, top).map((m) => listItem(m, ctx.userId, deps.refs, spoken)),
      }
    },
  })
}
