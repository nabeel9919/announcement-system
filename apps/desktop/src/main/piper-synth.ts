/**
 * Piper TTS synthesizer — runs in the main process (Node.js).
 *
 * Piper reads text from stdin and writes a WAV file to disk.
 * We return the WAV bytes as a Buffer so the renderer can play it.
 *
 * Binary + model live in:
 *   dev:  apps/desktop/resources/piper/
 *   prod: <app>/resources/piper/   (via electron-builder extraResources)
 */

import { spawn } from 'child_process'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { app } from 'electron'

// ── Path resolution ──────────────────────────────────────────────────────────

function getPiperDir(): string {
  // userData/piper takes priority — allows in-app download without reinstalling
  const userDataPiper = join(app.getPath('userData'), 'piper')
  const userBin = join(userDataPiper, process.platform === 'win32' ? 'piper.exe' : 'piper')
  if (existsSync(userBin)) return userDataPiper

  if (app.isPackaged) {
    // Production: electron-builder places extraResources here
    return join(process.resourcesPath, 'piper')
  }
  // Development: resources/ sits next to package.json of this workspace package
  return join(app.getAppPath(), 'resources', 'piper')
}

export function getPiperUserDataDir(): string {
  return join(app.getPath('userData'), 'piper')
}

export function getPiperBin(): string {
  const dir = getPiperDir()
  return join(dir, process.platform === 'win32' ? 'piper.exe' : 'piper')
}

/** Returns path to the .onnx model for a given language code (e.g. 'sw', 'en'). */
export function getPiperModel(lang: string): string | null {
  const dir = getPiperDir()
  const modelMap: Record<string, string> = {
    sw: 'sw_CD-lanfrica-medium.onnx',
    en: 'en_US-lessac-medium.onnx',
  }
  const modelFile = modelMap[lang] ?? modelMap['sw']
  const modelPath = join(dir, modelFile)
  return existsSync(modelPath) ? modelPath : null
}

export function isPiperAvailable(lang = 'sw'): boolean {
  return existsSync(getPiperBin()) && getPiperModel(lang) !== null
}

// ── Synthesis ────────────────────────────────────────────────────────────────

/**
 * Synthesize `text` with Piper, returning a WAV Buffer.
 * Uses a temp file for output — avoids binary streaming complexity.
 *
 * @param text   The text to speak.
 * @param lang   Language code ('sw' | 'en') — selects the model.
 */
export function synthesizeWithPiper(text: string, lang = 'sw'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const bin = getPiperBin()
    const model = getPiperModel(lang)

    if (!existsSync(bin)) {
      reject(new Error(`Piper binary not found: ${bin}`))
      return
    }
    if (!model) {
      reject(new Error(`Piper model not found for language "${lang}" in ${getPiperDir()}`))
      return
    }

    const outFile = join(tmpdir(), `piper_${randomUUID()}.wav`)

    const proc = spawn(bin, ['--model', model, '--output_file', outFile], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    proc.stdin.write(text, 'utf8')
    proc.stdin.end()

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Piper exited with code ${code}: ${stderr.trim()}`))
        return
      }
      if (!existsSync(outFile)) {
        reject(new Error(`Piper did not produce output file: ${outFile}`))
        return
      }
      try {
        const buf = readFileSync(outFile)
        unlinkSync(outFile)
        resolve(buf)
      } catch (e) {
        reject(e)
      }
    })

    proc.on('error', (e) => {
      reject(new Error(`Failed to spawn Piper: ${e.message}`))
    })

    // Safety timeout — kill after 30 s (very long text protection)
    const timeout = setTimeout(() => {
      proc.kill()
      reject(new Error('Piper synthesis timed out after 30 s'))
    }, 30_000)
    proc.on('close', () => clearTimeout(timeout))
  })
}
