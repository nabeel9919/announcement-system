import type { AnnouncementConfig } from '@announcement/shared'

/**
 * Web Speech API provider — works fully offline using OS voices.
 * Runs in the browser/renderer process only.
 *
 * Fixes applied:
 *  - Chrome bug: voices list empty on first call → wait for voiceschanged event
 *  - Chrome bug: speechSynthesis silently stops mid-session → 14s keepalive ping
 *  - Chrome bug: onend never fires on long text → hard timeout fallback
 *  - Cancelled utterances fire onerror('interrupted') → treat as success
 */
export class WebSpeechProvider {
  private config: AnnouncementConfig
  private keepalive: ReturnType<typeof setInterval> | null = null

  constructor(config: AnnouncementConfig) {
    this.config = config
  }

  static isAvailable(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  /**
   * Returns all available OS voices.
   * In Chrome, voices load asynchronously — this waits up to 1.5 s for them.
   */
  static getVoices(): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      if (!WebSpeechProvider.isAvailable()) { resolve([]); return }

      const voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) { resolve(voices); return }

      // Chrome: wait for voiceschanged
      const handler = () => {
        window.speechSynthesis.removeEventListener('voiceschanged', handler)
        resolve(window.speechSynthesis.getVoices())
      }
      window.speechSynthesis.addEventListener('voiceschanged', handler)

      // Fallback: don't wait forever
      setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', handler)
        resolve(window.speechSynthesis.getVoices())
      }, 1500)
    })
  }

  /** Speak text, returns a Promise that resolves when speech finishes. */
  speak(text: string, langOverride?: string): Promise<void> {
    return new Promise((resolve) => {
      if (!WebSpeechProvider.isAvailable()) { resolve(); return }

      // Clear any stuck speech
      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang     = langOverride ?? this.config.language
      utterance.volume   = this.config.volume
      utterance.rate     = this.config.rate ?? 0.9
      utterance.pitch    = this.config.pitch ?? 1

      // Voice selection: prefer explicitly chosen voice, then first match for language
      const voices = window.speechSynthesis.getVoices()
      const target = this.config.voiceName
        ? voices.find((v) => v.name === this.config.voiceName)
        : voices.find((v) => v.lang.startsWith(utterance.lang.split('-')[0]))
      if (target) utterance.voice = target

      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        this.stopKeepalive()
        resolve()
      }

      // Chrome keepalive: pause/resume every 14 s to prevent silent death
      this.stopKeepalive()
      this.keepalive = setInterval(() => {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.pause()
          window.speechSynthesis.resume()
        }
      }, 14_000)

      // Hard timeout: ~80 ms per character + 3 s buffer — avoids hanging forever
      const timeoutMs = Math.max(text.length * 80, 2000) + 3000
      const timer = setTimeout(done, timeoutMs)

      utterance.onend = () => { clearTimeout(timer); done() }
      utterance.onerror = (e) => {
        clearTimeout(timer)
        // 'interrupted' / 'canceled' = we called cancel() ourselves, treat as done
        if (e.error === 'interrupted' || e.error === 'canceled') { done(); return }
        // Any other error: still resolve so the queue keeps moving
        console.warn('[WebSpeech] error:', e.error)
        done()
      }

      window.speechSynthesis.speak(utterance)
    })
  }

  stop(): void {
    this.stopKeepalive()
    if (WebSpeechProvider.isAvailable()) {
      window.speechSynthesis.cancel()
    }
  }

  updateConfig(config: Partial<AnnouncementConfig>): void {
    this.config = { ...this.config, ...config }
  }

  private stopKeepalive() {
    if (this.keepalive !== null) {
      clearInterval(this.keepalive)
      this.keepalive = null
    }
  }
}
