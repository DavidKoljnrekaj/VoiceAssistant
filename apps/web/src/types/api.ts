// The SSE contract of `POST /chat`, exactly as docs/API.md states it. The event name on the wire
// always equals `type`; the client dispatches on the JSON. Changing an event here means changing
// the API in the same change.

export type ChatEvent =
  | { type: 'session'; session_id: string }
  /** Provisional: the `turn` that follows carries the canonical text. */
  | { type: 'delta'; text: string }
  | { type: 'turn'; role: 'assistant'; text: string; message_id: string }
  | { type: 'tool_call'; tool: string; input: unknown; tool_use_id: string }
  | { type: 'tool_result'; tool: string; output: unknown; tool_use_id: string; is_error: boolean }
  | { type: 'done'; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; code: string; message: string }

export type ChatEventType = ChatEvent['type']

const EVENT_TYPES: ReadonlySet<string> = new Set<ChatEventType>([
  'session',
  'delta',
  'turn',
  'tool_call',
  'tool_result',
  'done',
  'error',
])

/** Narrows a parsed SSE payload to a ChatEvent; anything unknown is dropped, never rendered. */
export function isChatEvent(value: unknown): value is ChatEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    EVENT_TYPES.has((value as { type: string }).type)
  )
}

export interface VoiceCallSession {
  url: string
  token: string
  room: string
  session_id: string
}

/**
 * A pre-stream (or non-stream) HTTP failure: the flat `{ error: { code, message } }` envelope with
 * its status. Mid-stream failures are `error` events, never thrown.
 */
export class ApiHttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiHttpError'
    this.status = status
    this.code = code
  }

  static async fromResponse(response: Response): Promise<ApiHttpError> {
    type Envelope = { error?: { code?: string; message?: string } }
    let payload: Envelope | null = null
    try {
      payload = (await response.json()) as Envelope
    } catch {
      /* a non-JSON body keeps the generic code */
    }
    return new ApiHttpError(
      response.status,
      payload?.error?.code ?? 'http_error',
      payload?.error?.message ?? `HTTP ${response.status}`,
    )
  }
}
