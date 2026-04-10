/**
 * Piper TTS provider — renderer side.
 *
 * Sends text to the main process via IPC (window.api.piper.synthesize),
 * receives a base64-encoded WAV, and plays it through the Web Audio API.
 *
 * This runs entirely offline — no internet required. The Piper binary and
 * model live in resources/piper/ and are bundled with the installer.
 */

export class PiperProvider {
  private lang: string
  private volume: number
  private audioCtx: AudioContext | null = null

  constructor(lang = 'sw', volume = 1) {
    this.lang = lang.split('-')[0].toLowerCase()
    this.volume = Math.max(0, Math.min(1, volume))
  }

  updateLang(lang: string): void {
    this.lang = lang.split('-')[0].toLowerCase()
  }

  updateVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
  }

  /**
   * Returns true if Piper binary + Swahili model are present.
   * Use this to decide whether to use Piper or fall back to Web Speech.
   */
  static async isAvailable(lang = 'sw'): Promise<boolean> {
    try {
      const api = (window as any).api
      if (!api?.piper) return false
      const status = await api.piper.status(lang)
      return status.available === true
    } catch {
      return false
    }
  }

  /**
   * Synthesize `text` with Piper and play it.
   * Resolves when playback finishes (or on error — so the queue keeps moving).
   */
  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      this._synthesizeAndPlay(text).then(resolve).catch(() => resolve())
    })
  }

  stop(): void {
    try { this.audioCtx?.close() } catch { /* ignore */ }
    this.audioCtx = null
  }

  // ── private ──────────────────────────────────────────────────────────────

  private async _synthesizeAndPlay(text: string): Promise<void> {
    const api = (window as any).api
    if (!api?.piper) throw new Error('piper IPC not available')

    // Request WAV from main process (base64 string)
    const base64Wav: string = await api.piper.synthesize(text, this.lang)

    // Decode base64 → ArrayBuffer
    const binary = atob(base64Wav)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    // Decode WAV with Web Audio API and play
    this.audioCtx = new AudioContext()
    const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer)

    return new Promise<void>((resolve, reject) => {
      if (!this.audioCtx) { resolve(); return }
      const source = this.audioCtx.createBufferSource()
      source.buffer = audioBuffer

      // Volume control via GainNode
      const gain = this.audioCtx.createGain()
      gain.gain.value = this.volume
      source.connect(gain)
      gain.connect(this.audioCtx.destination)

      source.onended = () => {
        this.audioCtx?.close().catch(() => {})
        this.audioCtx = null
        resolve()
      }
      source.start(0)

      // Hard timeout: WAV duration + 5 s buffer
      const durationMs = (audioBuffer.duration * 1000) + 5000
      setTimeout(() => {
        try { source.stop() } catch { /* already ended */ }
        resolve()
      }, durationMs)
    })
  }
}
