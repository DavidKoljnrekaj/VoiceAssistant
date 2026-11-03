// Which jobs the worker takes: those the API dispatched with a call token in the metadata (the
// in-app call), and those a SIP dispatch rule marked `{ "channel": "phone" }` (Part 11). There
// is no stub path in the worker; the stub LLM lives in `scripts/` for tuning runs.
import { log } from '@va/core'

import { LOG_TAG } from './config.js'

/** The call's opaque token from the job metadata, or null. Never logged. */
export function callTokenOf(metadata: string | undefined): string | null {
  try {
    const token = (JSON.parse(metadata || '{}') as { callToken?: unknown }).callToken
    return typeof token === 'string' && token ? token : null
  } catch {
    return null
  }
}

/** A phone job: the SIP dispatch rule's static metadata names the channel. */
export function phoneJobOf(metadata: string | undefined): boolean {
  try {
    return (JSON.parse(metadata || '{}') as { channel?: unknown }).channel === 'phone'
  } catch {
    return false
  }
}

/** The part of LiveKit's `JobRequest` the worker uses. */
export interface JobRequestLike {
  id: string
  job: { metadata?: string | undefined; room?: { name?: string } | undefined }
  accept(): Promise<void>
  reject(): Promise<void>
}

/** `ServerOptions.requestFunc`: accepts a dispatched call, refuses anything else. */
export async function acceptDispatchedJob(req: JobRequestLike): Promise<void> {
  const room = req.job.room?.name ?? ''
  if (!callTokenOf(req.job.metadata) && !phoneJobOf(req.job.metadata)) {
    log('warn', LOG_TAG, 'job refused', { job_id: req.id, room, reason: 'no call token, not a phone job' })
    await req.reject()
    return
  }
  await req.accept()
}
