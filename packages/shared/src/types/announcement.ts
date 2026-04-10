export type Sector =
  | 'hospital'
  | 'airport'
  | 'bank'
  | 'court'
  | 'pharmacy'
  | 'government'
  | 'immigration'
  | 'supermarket'
  | 'clinic'
  | 'other'

export type AudioProvider = 'web_speech' | 'google_tts' | 'elevenlabs' | 'system' | 'piper'

export interface AnnouncementConfig {
  provider: AudioProvider
  language: string           // BCP-47 e.g. "en-US", "sw-TZ", "ar-SA"
  /** Optional second language — announcement is repeated in this language after the primary */
  secondLanguage?: string
  voiceName?: string         // specific voice name for primary language
  secondVoiceName?: string   // specific voice name for second language
  volume: number             // 0–1
  rate: number               // 0.5–2.0
  pitch: number              // 0–2
  /** Delay between queue announcements in ms */
  interAnnouncementDelayMs: number
  /** Auto-recall after N seconds if not acknowledged (0 = disabled) */
  autoRecallAfterSeconds: number
  /** Max number of auto-recalls before marking as skipped */
  maxAutoRecalls: number
  /** Optional intro chime URL (local file) */
  chimeUrl?: string
}

export interface AnnouncementTemplate {
  /** Template string with placeholders */
  pattern: string
  /**
   * Placeholders:
   *  {number}   — ticket display number e.g. "A-017"
   *  {window}   — window label e.g. "Window 2"
   *  {name}     — caller name (name mode)
   *  {category} — category label e.g. "Outpatient"
   */
  examples: string[]
}

/** A scheduled non-queue announcement (e.g. "Welcome to City Hospital") */
export interface ScheduledMessage {
  id: string
  text: string
  cronExpression: string   // e.g. "0 8 * * 1-5" = weekdays 8am
  isActive: boolean
  language: string
}

/** Emergency broadcast — overrides all queues */
export interface EmergencyBroadcast {
  message: string
  language: string
  repeat: number   // how many times to repeat
  fullScreenAlert: boolean
}

export interface DisplayConfig {
  /** Screen index for display window (0 = primary, 1+ = external) */
  screenIndex: number
  theme: 'dark' | 'light'
  /** Organisation name shown on display */
  organizationName: string
  logoUrl?: string
  /** Scrolling ticker text at bottom */
  tickerText?: string
  /** Show clock on display */
  showClock: boolean
  /** Show date on display */
  showDate: boolean
  /** Font size multiplier for ticket numbers */
  numberFontScale: number
}

export interface AppSettings {
  announcement: AnnouncementConfig
  display: DisplayConfig
  sector: Sector
  organizationName: string
  thermalPrinterEnabled: boolean
  thermalPrinterPort?: string
}
