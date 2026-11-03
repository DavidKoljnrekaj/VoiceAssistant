// The keypad as a queue: DTMF digits arrive as room events whenever the caller presses them,
// the gate asks for the next one with a timeout. Digits pressed before the prompt are kept
// (a caller who knows the drill types ahead); `close()` ends every wait with null (the caller
// hung up during the PIN).

export class KeyQueue {
  private queue: string[] = []
  private waiter: { resolve: (key: string | null) => void; timer: NodeJS.Timeout } | null = null
  private closed = false

  push(key: string): void {
    if (this.closed) return
    if (this.waiter) {
      const { resolve, timer } = this.waiter
      clearTimeout(timer)
      this.waiter = null
      resolve(key)
      return
    }
    this.queue.push(key)
  }

  /** The next key, or null after `timeoutMs` without one or once closed. One waiter at a time:
   * a second concurrent call supersedes the first, which resolves null. */
  next(timeoutMs: number): Promise<string | null> {
    const queued = this.queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    if (this.closed) return Promise.resolve(null)
    if (this.waiter) {
      clearTimeout(this.waiter.timer)
      this.waiter.resolve(null)
      this.waiter = null
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = null
        resolve(null)
      }, timeoutMs)
      this.waiter = { resolve, timer }
    })
  }

  close(): void {
    this.closed = true
    this.queue = []
    if (this.waiter) {
      clearTimeout(this.waiter.timer)
      this.waiter.resolve(null)
      this.waiter = null
    }
  }
}
