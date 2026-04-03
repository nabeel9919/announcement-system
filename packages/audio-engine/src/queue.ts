/**
 * AnnouncementQueue — serializes TTS calls so they never overlap.
 * Works in the browser renderer process (Web Speech API context).
 */
export class AnnouncementQueue {
  private queue: Array<() => Promise<void>> = []
  private running = false

  enqueue(task: () => Promise<void>): void {
    this.queue.push(task)
    if (!this.running) {
      this.flush()
    }
  }

  private async flush(): Promise<void> {
    this.running = true
    while (this.queue.length > 0) {
      const task = this.queue.shift()!
      try {
        await task()
      } catch (err) {
        console.error('[AudioQueue] announcement failed:', err)
      }
    }
    this.running = false
  }

  clear(): void {
    this.queue = []
  }

  get length(): number {
    return this.queue.length
  }
}
