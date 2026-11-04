import { z } from 'zod'

import { defineTool } from '@va/core'

import { isAccessFailure, isSpoken, type MailDeps, TEXT_BODY, withGraph } from '../access.js'
import { cleanBody, clip, field, untrusted } from '../clean.js'
import { REF_PATTERN } from '../refs.js'
import { GraphError } from '../graph.js'
import { zagrebIso } from '../zagreb.js'
import { type GraphAddress, personName, senderName, subjectMax } from './messages.js'

const CHAT_BODY = 3000
const VOICE_BODY = 600

interface GraphFullMessage {
  subject?: string | null
  from?: GraphAddress | null
  toRecipients?: GraphAddress[] | null
  ccRecipients?: GraphAddress[] | null
  receivedDateTime?: string | null
  hasAttachments?: boolean | null
  importance?: string | null
  uniqueBody?: { contentType?: string; content?: string | null } | null
}

const CHAT_RECIPIENTS = 10
const VOICE_RECIPIENTS = 3

/** Recipients by name (an address only on chat and only when there is no name), capped; the
 * total says how many there were. */
function recipients(
  list: GraphAddress[] | null | undefined,
  spoken: boolean,
): { names: string[]; total: number } {
  const all = list ?? []
  const names = all
    .map((a) => personName(a, spoken))
    .filter((n): n is string => n !== null)
    .slice(0, spoken ? VOICE_RECIPIENTS : CHAT_RECIPIENTS)
  return { names, total: all.length }
}

export function readMail(deps: MailDeps) {
  return defineTool({
    name: 'read_mail',
    description:
      "Read one message of the user's own mailbox by the ref list_mail or search_mail returned (m1, m2 …). " +
      'Returns the sender and recipient names, the subject, when it arrived (ISO, Europe/Zagreb), whether it ' +
      'has attachments, and the new text of the message (quoted earlier mail, signatures and disclaimers ' +
      'removed), clipped; `truncated` says when there is more. Reading does not mark the message as read. ' +
      'Call it when the user wants to hear or see what a message says. It needs a ref from a list in this ' +
      'conversation: never guess one, and if the ref has expired, list or search again.',
    input: z.object({
      ref: z
        .string()
        .regex(REF_PATTERN, 'a ref such as m1')
        .describe('The message ref from list_mail or search_mail, e.g. "m2".'),
    }),
    requiredRoles: ['admin', 'member'],
    readOnly: true,
    async handler(input, ctx, extras, signal) {
      const spoken = isSpoken(extras.channel)
      const graphId = deps.refs.resolve(ctx.userId, input.ref)
      if (!graphId)
        return {
          error: 'ref_expired',
          hint: 'This ref is unknown or older than 30 minutes. List or search the mail again for fresh refs.',
        }
      let result
      try {
        result = await withGraph(deps, ctx, signal, (graph) =>
          graph.get<GraphFullMessage>(`/me/messages/${encodeURIComponent(graphId)}`, {
            select: [
              'subject',
              'from',
              'toRecipients',
              'ccRecipients',
              'receivedDateTime',
              'hasAttachments',
              'importance',
              'uniqueBody',
            ],
            prefer: [TEXT_BODY],
            signal,
          }),
        )
      } catch (e) {
        if (e instanceof GraphError && e.kind === 'not_found') return { error: 'message_not_found' }
        throw e
      }
      if (isAccessFailure(result)) return result
      const body = clip(cleanBody(result.uniqueBody?.content ?? ''), spoken ? VOICE_BODY : CHAT_BODY)
      const to = recipients(result.toRecipients, spoken)
      const cc = recipients(result.ccRecipients, spoken)
      return {
        // The model already holds the ref; on a call nothing that stands for an id goes back.
        ...(spoken ? {} : { ref: input.ref }),
        from: senderName(result.from, spoken),
        to: to.names,
        to_total: to.total,
        cc: cc.names,
        cc_total: cc.total,
        subject: field(result.subject, subjectMax(spoken)) || '(bez predmeta)',
        received: result.receivedDateTime ? zagrebIso(result.receivedDateTime) : null,
        has_attachments: result.hasAttachments === true,
        importance: result.importance ?? 'normal',
        body: untrusted(body.text),
        truncated: body.truncated,
      }
    },
  })
}
