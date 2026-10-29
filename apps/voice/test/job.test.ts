// W01: which jobs the worker takes.
import { describe, expect, it } from 'vitest'

import { acceptDispatchedJob, callTokenOf, type JobRequestLike } from '../src/job.js'
import { logs, scenario } from './harness.js'

function request(metadata: string | undefined): JobRequestLike & { accepted: number; rejected: number } {
  const req = {
    id: 'AJ_test',
    job: { metadata, room: { name: 'voice-x' } },
    accepted: 0,
    rejected: 0,
    async accept() {
      req.accepted++
    },
    async reject() {
      req.rejected++
    },
  }
  return req
}

describe('job acceptance', () => {
  scenario('W01 a job without callToken is refused and logged; a dispatched one is accepted', async () => {
    const bare = request('')
    await acceptDispatchedJob(bare)
    expect(bare).toMatchObject({ accepted: 0, rejected: 1 })
    const line = logs.find((l) => l.line.includes('job refused'))
    expect(line?.level).toBe('warn')
    expect(line?.line).toContain('"room":"voice-x"')

    const dispatched = request(JSON.stringify({ callToken: 'abc', sessionId: 's' }))
    await acceptDispatchedJob(dispatched)
    expect(dispatched).toMatchObject({ accepted: 1, rejected: 0 })
    expect(logs.filter((l) => l.line.includes('abc'))).toHaveLength(0)
  })

  it('W01b callTokenOf reads only a non-empty string token', () => {
    expect(callTokenOf(undefined)).toBeNull()
    expect(callTokenOf('not json')).toBeNull()
    expect(callTokenOf('{}')).toBeNull()
    expect(callTokenOf('{"callToken":""}')).toBeNull()
    expect(callTokenOf('{"callToken":42}')).toBeNull()
    expect(callTokenOf('{"callToken":"t","sessionId":"s"}')).toBe('t')
  })
})
