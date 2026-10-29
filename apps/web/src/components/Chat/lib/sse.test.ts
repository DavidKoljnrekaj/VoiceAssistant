import { describe, expect, it } from 'vitest'

import { createSseParser, parseSseFrame, readSseBody, type SseFrame } from './sse'

function collect(): { frames: SseFrame[]; parser: ReturnType<typeof createSseParser> } {
  const frames: SseFrame[] = []
  return { frames, parser: createSseParser((f) => frames.push(f)) }
}

describe('SSE frame parser', () => {
  it('S01: a frame split across chunks is dispatched once, whole', () => {
    const { frames, parser } = collect()
    parser.push('event: delta\ndata: {"type":"del')
    expect(frames).toEqual([])
    parser.push('ta","text":"Bok"}\n\n')
    expect(frames).toEqual([{ event: 'delta', data: '{"type":"delta","text":"Bok"}' }])
  })

  it('S02: comment frames (ready, keepalive) are ignored', () => {
    const { frames, parser } = collect()
    parser.push(': ready\n\n: keepalive\n\nevent: done\ndata: {"type":"done"}\n\n')
    expect(frames).toEqual([{ event: 'done', data: '{"type":"done"}' }])
  })

  it('S03: several data lines in one frame are joined with a newline', () => {
    expect(parseSseFrame('data: a\ndata: b\ndata:c')).toEqual({ event: null, data: 'a\nb\nc' })
  })

  it('S04: a chunk carrying several frames dispatches each in order; CRLF is accepted', () => {
    const { frames, parser } = collect()
    parser.push('data: 1\r\n\r\ndata: 2\r\n\r\n')
    expect(frames.map((f) => f.data)).toEqual(['1', '2'])
  })

  it('S05: end() returns the unterminated remainder, which is never dispatched', () => {
    const { frames, parser } = collect()
    parser.push('data: whole\n\ndata: partial')
    expect(frames.map((f) => f.data)).toEqual(['whole'])
    expect(parser.end()).toBe('data: partial')
    expect(parser.end()).toBe('')
  })

  it('S06: readSseBody parses the data of every frame as JSON and drops what is not JSON', async () => {
    const encoder = new TextEncoder()
    const chunks = [
      ': ready\n\nevent: session\ndata: {"type":"session","session_id":"s1"}\n\nevent: delta\ndata: {"type":"delta",',
      '"text":"Dobar dan"}\n\ndata: not json\n\nevent: done\ndata: {"type":"done","stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":2}}\n\n',
    ]
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c))
        controller.close()
      },
    })
    const payloads: unknown[] = []
    await readSseBody(body, (p) => payloads.push(p))
    expect(payloads).toEqual([
      { type: 'session', session_id: 's1' },
      { type: 'delta', text: 'Dobar dan' },
      { type: 'done', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } },
    ])
  })

  it('S07: a multi-byte character split between two chunks decodes correctly', async () => {
    const bytes = new TextEncoder().encode('data: {"type":"delta","text":"Š"}\n\n')
    const cut = 24 // inside the two-byte Š
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut))
        controller.enqueue(bytes.slice(cut))
        controller.close()
      },
    })
    const payloads: unknown[] = []
    await readSseBody(body, (p) => payloads.push(p))
    expect(payloads).toEqual([{ type: 'delta', text: 'Š' }])
  })
})
