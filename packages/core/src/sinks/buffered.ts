// A sink that keeps everything: for tests and for any non-streamed response.
import type { ErrorCode } from '../errors.js'
import type { EventSink, Usage } from '../loop/ports.js'

export class BufferedSink implements EventSink {
  /** Every delta concatenated. */
  text = ''
  toolStarts = 0
  blocks: Array<{ text: string; messageId: string }> = []
  toolCalls: Array<{ tool: string; input: unknown; id: string }> = []
  toolResults: Array<{ tool: string; output: unknown; id: string; isError: boolean }> = []
  doneEvent: { stopReason: string; usage: Usage } | null = null
  errorEvent: { code: ErrorCode; message: string } | null = null
  /** Every call in order, by method name, for ordering assertions. */
  order: string[] = []

  async textDelta(text: string): Promise<void> {
    this.text += text
    this.order.push('textDelta')
  }
  async toolStarting(): Promise<void> {
    this.toolStarts++
    this.order.push('toolStarting')
  }
  async textBlock(text: string, messageId: string): Promise<void> {
    this.blocks.push({ text, messageId })
    this.order.push('textBlock')
  }
  async toolCall(tool: string, input: unknown, id: string): Promise<void> {
    this.toolCalls.push({ tool, input, id })
    this.order.push('toolCall')
  }
  async toolResult(tool: string, output: unknown, id: string, isError: boolean): Promise<void> {
    this.toolResults.push({ tool, output, id, isError })
    this.order.push('toolResult')
  }
  async done(stopReason: string, usage: Usage): Promise<void> {
    this.doneEvent = { stopReason, usage }
    this.order.push('done')
  }
  async error(code: ErrorCode, message: string): Promise<void> {
    this.errorEvent = { code, message }
    this.order.push('error')
  }
}
