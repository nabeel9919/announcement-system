import type { AnnouncementConfig } from '@announcement/shared'

/**
 * Web Speech API provider — works fully offline using OS voices.
 * Runs in the browser/renderer process only.
 */
export class WebSpeechProvider {
  private config: AnnouncementConfig

  constructor(config: AnnouncementConfig) {
    this.config = config
  }

  /** Returns true if Web Speech API is available in this context */
  static isAvailable(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  /** List all voices available from the OS */
  static getVoices(): SpeechSynthesisVoice[] {
    if (!WebSpeechProvider.isAvailable()) return []
    return window.speechSynthesis.getVoices()
  }

  /** Speak text, returns a Promise that resolves when done */
  speak(text: string, langOverride?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!WebSpeechProvider.isAvailable()) {
        reject(new Error('Web Speech API not available'))
        return
      }

      // Cancel any current speech
      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = langOverride ?? this.config.language
      utterance.volume = this.config.volume
      utterance.rate = this.config.rate
      utterance.pitch = this.config.pitch

      // Try to find a matching voice
      const voices = window.speechSynthesis.getVoices()
      const matchingVoice = voices.find(
        (v) =>
          v.lang.startsWith(utterance.lang.split('-')[0]) &&
          (this.config.voiceName ? v.name === this.config.voiceName : true)
      )
      if (matchingVoice) {
        utterance.voice = matchingVoice
      }

      utterance.onend = () => resolve()
      utterance.onerror = (e) => reject(new Error(`SpeechSynthesis error: ${e.error}`))

      window.speechSynthesis.speak(utterance)
    })
  }

  stop(): void {
    if (WebSpeechProvider.isAvailable()) {
      window.speechSynthesis.cancel()
    }
  }

  updateConfig(config: Partial<AnnouncementConfig>): void {
    this.config = { ...this.config, ...config }
  }
}
