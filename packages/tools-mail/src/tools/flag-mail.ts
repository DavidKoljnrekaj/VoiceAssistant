import { z } from 'zod'

import { defineTool } from '@va/core'

import { isAccessFailure, isSpoken, type MailDeps, withGraph } from '../access.js'
import { GraphError } from '../graph.js'
import { REF_PATTERN } from '../refs.js'
import { isTargetFailure, loadTarget, previewFailure } from './target.js'

export function flagMail(deps: MailDeps) {
  return defineTool({
    name: 'flag_mail',
    description:
      'Flag one message (a ref) for follow-up; nothing else. The user is asked first; after a yes, call again with the same ref.',
    input: z.object({
      ref: z.string().regex(REF_PATTERN, 'a ref such as m1').describe('e.g. "m2".'),
    }),
    requiredRoles: ['admin', 'member'],
    readOnly: false,
    confirmation: 'required',
    /** <!-- needs native review --> */
    async preview(input, ctx, extras, signal) {
      const target = await loadTarget(deps, ctx, input.ref, isSpoken(extras.channel), signal, {
        requireSender: false,
      })
      if (isTargetFailure(target)) throw previewFailure(target)
      return `Označit ću zastavicom poruku „${target.subject}“. Pošiljatelj je ${target.sender}.`
    },
    async handler(input, ctx, extras, signal) {
      const target = await loadTarget(deps, ctx, input.ref, isSpoken(extras.channel), signal, {
        requireSender: false,
      })
      if (isTargetFailure(target)) return target
      let flagged
      try {
        flagged = await withGraph(deps, ctx, signal, (graph) =>
          graph.patch<unknown>(
            `/me/messages/${encodeURIComponent(target.graphId)}`,
            { flag: { flagStatus: 'flagged' } },
            { signal },
          ),
        )
      } catch (e) {
        if (e instanceof GraphError && e.kind === 'not_found') return { error: 'message_not_found' }
        throw e
      }
      if (isAccessFailure(flagged)) return flagged
      return { flagged: true, subject: target.subject }
    },
  })
}
