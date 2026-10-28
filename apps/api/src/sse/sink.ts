// Chat's sink: the loop's events as SSE frames. Deltas are provisional; `turn` carries the
// canonical text and the row id (docs/decisions/0008).
import type { ErrorCode, EventSink, Usage } from '@va/core'

import type { SSEWriter } from './writer.js'

export class SseEventSink implements EventSink {
  constructor(
    private readonly sse: SSEWriter,
    private readonly onFirstDelta?: () => void,
  ) {}
  private firstDelta = true

  async textDelta(text: string): Promise<void> {
    if (this.firstDelta) {
      this.firstDelta = false
      this.onFirstDelta?.()
    }
    await this.sse.writeEvent({ type: 'delta', text })
  }
  async toolStarting(): Promise<void> {}
  async textBlock(text: string, messageId: string): Promise<void> {
    await this.sse.writeEvent({ type: 'turn', role: 'assistant', text, message_id: messageId })
  }
  async toolCall(tool: string, input: unknown, id: string): Promise<void> {
    await this.sse.writeEvent({ type: 'tool_call', tool, input, tool_use_id: id })
  }
  async toolResult(tool: string, output: unknown, id: string, isError: boolean): Promise<void> {
    await this.sse.writeEvent({ type: 'tool_result', tool, output, tool_use_id: id, is_error: isError })
  }
  async done(stopReason: string, usage: Usage): Promise<void> {
    await this.sse.writeEvent({ type: 'done', stop_reason: stopReason, usage })
  }
  async error(code: ErrorCode, message: string): Promise<void> {
    await this.sse.writeEvent({ type: 'error', code, message })
  }
}
