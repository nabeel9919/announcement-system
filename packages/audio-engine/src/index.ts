import type { AnnouncementConfig, AppSettings } from '@announcement/shared'
import { AnnouncementQueue } from './queue'
import { WebSpeechProvider } from './providers/web-speech'
import { GoogleTTSProvider } from './providers/google-tts'
import { PiperProvider } from './providers/piper'

export { AnnouncementQueue } from './queue'
export { WebSpeechProvider } from './providers/web-speech'
export { GoogleTTSProvider } from './providers/google-tts'
export { PiperProvider } from './providers/piper'

/**
 * Main audio engine — abstracts over TTS providers with automatic fallback.
 *
 * Priority:
 *  1. Google TTS (if configured and license server reachable)
 *  2. Web Speech API (offline, always available)
 *
 * Production-ready fixes:
 *  - Chrome Web Speech silent death → keepalive + hard timeout (in WebSpeechProvider)
 *  - Voices not loaded on first call → async getVoices()
 *  - Queue overflow protection — drops excess if queue > 3
 *  - Multilingual: primary language + optional second-language repeat
 */
export class AudioEngine {
  private queue = new AnnouncementQueue()
  private webSpeech: WebSpeechProvider
  private googleTTS: GoogleTTSProvider | null = null
  private piper: PiperProvider | null = null
  private config: AnnouncementConfig
  private chimeAudio: HTMLAudioElement | null = null

  constructor(config: AnnouncementConfig, licenseServerUrl?: string) {
    this.config = config
    this.webSpeech = new WebSpeechProvider(config)

    if (config.provider === 'piper') {
      const lang = config.language.split('-')[0].toLowerCase()
      this.piper = new PiperProvider(lang, config.volume)
    }

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
      this.chimeAudio.volume = Math.max(0, Math.min(1, config.volume))
    }
  }

  /**
   * Announce text. Chime → primary language → optional second language.
   * Calls are serialized — never overlap.
   * If queue is already backed up by 3+, drops the oldest pending to avoid pile-up.
   */
  announce(text: string, langOverride?: string): void {
    // Overflow protection: if queue is backed up, clear excess
    if (this.queue.length > 2) {
      this.queue.dropOldest()
    }

    this.queue.enqueue(async () => {
      // Chime
      if (this.chimeAudio) await this.playChime()
      await this.delay(250)

      // Primary speech
      await this.speakText(text, langOverride)

      // Second language repeat (if configured)
      if (this.config.secondLanguage && this.config.secondLanguage !== this.config.language) {
        await this.delay(600)
        await this.speakText(text, this.config.secondLanguage)
      }

      // Inter-announcement gap
      await this.delay(this.config.interAnnouncementDelayMs ?? 1500)
    })
  }

  /**
   * Same as announce() but marks this as a recall — prepends "Recall:" prefix.
   */
  announceRecall(text: string): void {
    this.announce(`Recall. ${text}`)
  }

  stop(): void {
    this.queue.clear()
    this.webSpeech.stop()
    this.googleTTS?.stop()
    this.piper?.stop()
  }

  /**
   * Update config at runtime (e.g. user changed voice/volume in settings).
   * Rebuilds chime audio if chimeUrl changed.
   */
  setConfig(config: Partial<AnnouncementConfig>): void {
    this.config = { ...this.config, ...config }
    this.webSpeech.updateConfig(this.config)

    // Rebuild Piper if provider or language changed
    if (config.provider !== undefined || config.language !== undefined || config.volume !== undefined) {
      if (this.config.provider === 'piper') {
        const lang = this.config.language.split('-')[0].toLowerCase()
        if (this.piper) {
          this.piper.updateLang(lang)
          this.piper.updateVolume(this.config.volume)
        } else {
          this.piper = new PiperProvider(lang, this.config.volume)
        }
      } else {
        this.piper?.stop()
        this.piper = null
      }
    }

    if (config.chimeUrl !== undefined) {
      if (config.chimeUrl) {
        this.chimeAudio = new Audio(config.chimeUrl)
        this.chimeAudio.volume = Math.max(0, Math.min(1, this.config.volume))
      } else {
        this.chimeAudio = null
      }
    }

    if (config.volume !== undefined && this.chimeAudio) {
      this.chimeAudio.volume = Math.max(0, Math.min(1, config.volume))
    }
  }

  /** @deprecated Use setConfig() */
  updateConfig(config: Partial<AnnouncementConfig>): void {
    this.setConfig(config)
  }

  get queueLength(): number {
    return this.queue.length
  }

  private async speakText(text: string, lang?: string): Promise<void> {
    try {
      if (this.googleTTS) {
        await this.googleTTS.speak(text)
      } else if (this.piper) {
        await this.piper.speak(text)
      } else {
        await this.webSpeech.speak(text, lang)
      }
    } catch {
      // Fallback: always try Web Speech
      try { await this.webSpeech.speak(text, lang) } catch { /* swallow */ }
    }
  }

  private playChime(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.chimeAudio) { resolve(); return }
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
 * Build TTS announcement text.
 *
 * mode:
 *   'ticket' — queue ticket (default): "Mwenye tiketi OPD namba 21 tafadhali elekea..."
 *   'card'   — card-based call:        "Mwenye kadi OPD namba 21 tafadhali elekea..."
 *   'name'   — call by name:           "Nabil Hamad tafadhali elekea..."
 */
export function buildAnnouncementText(params: {
  displayNumber: string
  windowLabel: string
  calleeName?: string
  announcementPrefix?: string   // legacy, ignored when language templates are used
  language?: string
  mode?: 'ticket' | 'card' | 'name'
}): string {
  const {
    displayNumber,
    windowLabel,
    calleeName,
    language = 'en',
    mode,
  } = params

  const lang = language.split('-')[0].toLowerCase()

  // Determine actual mode
  const resolvedMode: 'ticket' | 'card' | 'name' =
    mode ?? (calleeName && !displayNumber ? 'name' : calleeName ? 'name' : 'ticket')

  if (resolvedMode === 'name') {
    return buildNameText(calleeName ?? displayNumber, windowLabel, lang)
  }

  return buildNumberText(displayNumber, windowLabel, lang, resolvedMode)
}

function buildNumberText(
  displayNumber: string,
  windowLabel: string,
  lang: string,
  mode: 'ticket' | 'card',
): string {
  const expanded = expandTicketNumber(displayNumber)

  switch (lang) {
    case 'sw':
      return mode === 'card'
        ? `Tangazo. Mwenye kadi, ${expanded}, tafadhali elekea ${windowLabel}.`
        : `Tangazo. Mwenye tiketi, ${expanded}, tafadhali elekea ${windowLabel}.`
    case 'ar':
      return mode === 'card'
        ? `إعلان. صاحب البطاقة رقم ${displayNumber}، يرجى التوجه إلى ${windowLabel}.`
        : `إعلان. صاحب التذكرة رقم ${displayNumber}، يرجى التوجه إلى ${windowLabel}.`
    case 'fr':
      return mode === 'card'
        ? `Annonce. Le titulaire de la carte numéro ${expanded}, veuillez vous rendre à ${windowLabel}.`
        : `Annonce. Le titulaire du ticket numéro ${expanded}, veuillez vous rendre à ${windowLabel}.`
    default: // en
      return mode === 'card'
        ? `Announcement. Card holder ${expanded}, please proceed to ${windowLabel}.`
        : `Announcement. Ticket number ${expanded}, please proceed to ${windowLabel}.`
  }
}

function buildNameText(name: string, windowLabel: string, lang: string): string {
  switch (lang) {
    case 'sw':
      return `Tangazo. ${name}, tafadhali elekea ${windowLabel}.`
    case 'ar':
      return `إعلان. ${name}، يرجى التوجه إلى ${windowLabel}.`
    case 'fr':
      return `Annonce. ${name}, veuillez vous rendre à ${windowLabel}.`
    default: // en
      return `Announcement. ${name}, please proceed to ${windowLabel}.`
  }
}

/**
 * Expand a ticket display number for natural TTS reading.
 * "A-017" → "A, zero one seven"
 * "OPD-005" → "O P D, zero zero five"
 */
export function expandTicketNumber(displayNumber: string): string {
  return displayNumber
    .replace(/-/g, ', ')
    .replace(/\s+/g, ', ')
    .split(', ')
    .map((part) => {
      if (/^\d+$/.test(part)) {
        return part
          .split('')
          .map((d) => ['zero','one','two','three','four','five','six','seven','eight','nine'][+d])
          .join(' ')
      }
      if (/^[A-Z]+$/.test(part) && part.length > 1) {
        return part.split('').join(' ')
      }
      return part
    })
    .join(', ')
}

export type { AnnouncementConfig, AppSettings }
