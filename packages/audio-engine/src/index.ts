import type { AnnouncementConfig, AppSettings } from '@announcement/shared'
import { AnnouncementQueue } from './queue'
import { WebSpeechProvider } from './providers/web-speech'
import { GoogleTTSProvider } from './providers/google-tts'

export { AnnouncementQueue } from './queue'
export { WebSpeechProvider } from './providers/web-speech'
export { GoogleTTSProvider } from './providers/google-tts'

/**
 * Main audio engine — abstracts over TTS providers with automatic fallback.
 *
 * Priority:
 *  1. Google TTS / ElevenLabs (if configured and online)
 *  2. Web Speech API (always available, offline)
 */
export class AudioEngine {
  private queue = new AnnouncementQueue()
  private webSpeech: WebSpeechProvider
  private googleTTS: GoogleTTSProvider | null = null
  private config: AnnouncementConfig
  private chimeAudio: HTMLAudioElement | null = null

  constructor(config: AnnouncementConfig, licenseServerUrl?: string) {
    this.config = config
    this.webSpeech = new WebSpeechProvider(config)

    if (licenseServerUrl && config.provider === 'google_tts') {
      this.googleTTS = new GoogleTTSProvider({
        proxyUrl: licenseServerUrl,
        language: config.language,
        voiceName: config.voiceName,
        speakingRate: config.rate,
        pitch: config.pitch,
        volume: config.volume,
      })
    }

    if (config.chimeUrl) {
      this.chimeAudio = new Audio(config.chimeUrl)
      this.chimeAudio.volume = config.volume
    }
  }

  /**
   * Announce text. Plays chime first if configured, then speaks text.
   * Calls are automatically serialized — never overlap.
   */
  announce(text: string, langOverride?: string): void {
    this.queue.enqueue(async () => {
      // Play chime
      if (this.chimeAudio) {
        await this.playChime()
      }

      // Small pause after chime
      await this.delay(300)

      // Speak
      try {
        if (this.googleTTS) {
          await this.googleTTS.speak(text)
        } else {
          await this.webSpeech.speak(text, langOverride)
        }
      } catch {
        // Fallback to Web Speech
        await this.webSpeech.speak(text, langOverride)
      }

      // Inter-announcement delay
      await this.delay(this.config.interAnnouncementDelayMs)
    })
  }

  stop(): void {
    this.queue.clear()
    this.webSpeech.stop()
    this.googleTTS?.stop()
  }

  updateConfig(config: Partial<AnnouncementConfig>): void {
    this.config = { ...this.config, ...config }
    this.webSpeech.updateConfig(config)
  }

  get queueLength(): number {
    return this.queue.length
  }

  private playChime(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.chimeAudio) {
        resolve()
        return
      }
      this.chimeAudio.currentTime = 0
      this.chimeAudio.onended = () => resolve()
      this.chimeAudio.play().catch(() => resolve())
    })
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Build TTS announcement text from a ticket display number and window label.
 * Expands abbreviations for natural speech.
 */
export function buildAnnouncementText(params: {
  displayNumber: string
  windowLabel: string
  announcementPrefix?: string
  calleeName?: string
}): string {
  const { displayNumber, windowLabel, announcementPrefix = 'Attention please,', calleeName } = params

  if (calleeName) {
    return `${announcementPrefix} ${calleeName}, please proceed to ${windowLabel}`
  }

  // Expand number for better TTS — "A-017" → "A, zero one seven"
  const expanded = expandTicketNumber(displayNumber)
  return `${announcementPrefix} ${expanded}, please proceed to ${windowLabel}`
}

/**
 * Expand a ticket display number for natural TTS reading.
 * "OPD K 11" → "O P D, K, Eleven"
 * "A-017"    → "A, Zero One Seven"
 */
export function expandTicketNumber(displayNumber: string): string {
  return displayNumber
    .replace(/-/g, ', ')
    .replace(/\s+/g, ', ')
    .split(', ')
    .map((part) => {
      // If it's all digits, spell them out
      if (/^\d+$/.test(part)) {
        return part
          .split('')
          .map((d) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][+d])
          .join(' ')
      }
      // If it's all letters, space them out for TTS (so "OPD" is read as "O P D")
      if (/^[A-Z]+$/.test(part) && part.length > 1) {
        return part.split('').join(' ')
      }
      return part
    })
    .join(', ')
}

export type { AnnouncementConfig, AppSettings }
