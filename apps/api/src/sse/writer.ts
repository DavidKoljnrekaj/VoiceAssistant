// Server-sent events: framing plus the idle keepalive, ported from Landmark. One heartbeat timer
// fires every 15 s unless a real write resets it; a write that throws means the socket is dead,
// so `onWriteFailure` fires once and later writes are silent no-ops. `close` is idempotent.
import type { ErrorCode } from '@va/core'

export const HEARTBEAT_INTERVAL_MS = 15_000

export type SseEvent =
  | { type: 'session'; session_id: string }
  | { type: 'delta'; text: string }
  | { type: 'turn'; role: 'assistant'; text: string; message_id: string }
  | { type: 'tool_call'; tool: string; input: unknown; tool_use_id: string }
  | { type: 'tool_result'; tool: string; output: unknown; tool_use_id: string; is_error: boolean }
  | { type: 'done'; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; code: ErrorCode; message: string }

export class SSEWriter {
  private readonly encoder = new TextEncoder()
  private heartbeat: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private writeFailureFired = false

  constructor(
    private readonly writer: WritableStreamDefaultWriter<Uint8Array>,
    private readonly onWriteFailure?: () => void,
    private readonly heartbeatMs = HEARTBEAT_INTERVAL_MS,
  ) {
    this.scheduleHeartbeat()
  }

  /** `event: <type>\ndata: <json>\n\n`. The event name always equals `data.type`. */
  async writeEvent(data: SseEvent): Promise<void> {
    await this.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  /** `: <text>\n\n`: `ready` once the headers are flushed, `keepalive` while idle. */
  async writeComment(text: string): Promise<void> {
    await this.write(`: ${text}\n\n`)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.clearHeartbeat()
    try {
      await this.writer.close()
    } catch {
      // already closed by the other side
    }
  }

  private async write(frame: string): Promise<void> {
    if (this.closed) return
    try {
      await this.writer.write(this.encoder.encode(frame))
      this.scheduleHeartbeat()
    } catch {
      this.notifyWriteFailure()
    }
  }

  private scheduleHeartbeat(): void {
    if (this.closed) return
    this.clearHeartbeat()
    this.heartbeat = setTimeout(() => {
      if (this.closed) return
      // The heartbeat doubles as a liveness probe: a failed write means the client is gone.
      this.writer
        .write(this.encoder.encode(': keepalive\n\n'))
        .then(() => this.scheduleHeartbeat())
        .catch(() => this.notifyWriteFailure())
    }, this.heartbeatMs)
  }

  private clearHeartbeat(): void {
    if (this.heartbeat !== undefined) {
      clearTimeout(this.heartbeat)
      this.heartbeat = undefined
    }
  }

  private notifyWriteFailure(): void {
    if (this.writeFailureFired) return
    this.writeFailureFired = true
    this.closed = true
    this.clearHeartbeat()
    this.onWriteFailure?.()
  }
}
