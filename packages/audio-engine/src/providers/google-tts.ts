/**
 * Google Cloud Text-to-Speech provider.
 * Requires GOOGLE_TTS_API_KEY environment variable on the license server.
 * The desktop app requests audio from the license server proxy to keep the API key secure.
 */
export interface GoogleTTSOptions {
  /** License server proxy URL */
  proxyUrl: string
  language: string
  voiceName?: string
  volume?: number
  speakingRate?: number
  pitch?: number
}

export class GoogleTTSProvider {
  private options: GoogleTTSOptions
  private audioContext: AudioContext | null = null

  constructor(options: GoogleTTSOptions) {
    this.options = options
  }

  async speak(text: string): Promise<void> {
    const response = await fetch(`${this.options.proxyUrl}/api/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        language: this.options.language,
        voiceName: this.options.voiceName,
        speakingRate: this.options.speakingRate ?? 1.0,
        pitch: this.options.pitch ?? 0,
      }),
    })

    if (!response.ok) {
      throw new Error(`Google TTS proxy error: ${response.status}`)
    }

    const audioData = await response.arrayBuffer()
    await this.playAudioBuffer(audioData)
  }

  private async playAudioBuffer(buffer: ArrayBuffer): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
    }

    const decoded = await this.audioContext.decodeAudioData(buffer)
    const source = this.audioContext.createBufferSource()
    source.buffer = decoded

    // Apply volume
    const gainNode = this.audioContext.createGain()
    gainNode.gain.value = this.options.volume ?? 1.0
    source.connect(gainNode)
    gainNode.connect(this.audioContext.destination)

    return new Promise((resolve) => {
      source.onended = () => resolve()
      source.start(0)
    })
  }

  stop(): void {
    this.audioContext?.close()
    this.audioContext = null
  }
}
