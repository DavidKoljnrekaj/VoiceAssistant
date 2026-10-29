// A pure SSE frame parser for `fetch` + `ReadableStream` (never `EventSource`: POST and headers are
// needed). Frames end on a blank line; comment lines (`:`) are ignored; several `data:` lines are
// joined with `\n`. The `event:` line is carried but the JSON's own `type` is what the client
// dispatches on (docs/API.md: the two are always equal).

export interface SseFrame {
  event: string | null
  /** The joined `data:` lines, or null for a comment-only frame. */
  data: string | null
}

export function parseSseFrame(frame: string): SseFrame {
  let event: string | null = null
  const data: string[] = []
  for (const line of frame.split('\n')) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
    // `id:` and `retry:` are not part of the contract and are ignored.
  }
  return { event, data: data.length > 0 ? data.join('\n') : null }
}

export interface SseParser {
  /** Feeds decoded text; frames completed by it are dispatched in order. */
  push(chunk: string): void
  /** Ends the stream; returns whatever partial frame was left (dropped, as the API never splits a frame). */
  end(): string
}

export function createSseParser(onFrame: (frame: SseFrame) => void): SseParser {
  let buffer = ''
  return {
    push(chunk) {
      buffer += chunk.replace(/\r\n/g, '\n')
      let separator: number
      while ((separator = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        if (frame.length === 0) continue
        const parsed = parseSseFrame(frame)
        // A comment-only frame (`: ready`, `: keepalive`) carries nothing and is not dispatched.
        if (parsed.event !== null || parsed.data !== null) onFrame(parsed)
      }
    },
    end() {
      const rest = buffer
      buffer = ''
      return rest
    },
  }
}

/** Reads a whole response body, dispatching each parsed JSON `data:` payload; non-JSON data is dropped. */
export async function readSseBody(
  body: ReadableStream<Uint8Array>,
  onData: (payload: unknown) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  const parser = createSseParser((frame) => {
    if (frame.data === null) return
    let payload: unknown
    try {
      payload = JSON.parse(frame.data)
    } catch {
      return
    }
    onData(payload)
  })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    parser.end()
  } finally {
    reader.releaseLock()
  }
}
