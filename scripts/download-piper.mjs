#!/usr/bin/env node
/**
 * Downloads Piper TTS binary + Swahili model into apps/desktop/resources/piper/
 *
 * Works on: Linux x64, Windows x64, macOS x64/arm64
 * No extra npm packages needed — uses only Node.js built-ins.
 *
 * Usage:
 *   node scripts/download-piper.mjs
 *   node scripts/download-piper.mjs --lang sw     (Swahili, default)
 *   node scripts/download-piper.mjs --lang en     (English)
 */

import { createWriteStream, existsSync, mkdirSync, chmodSync, renameSync, rmSync, unlinkSync } from 'fs'
import { pipeline } from 'stream/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR   = join(__dirname, '..', 'apps', 'desktop', 'resources', 'piper')

const VERSION   = '2023.11.14-2'

// ── Platform detection ────────────────────────────────────────────────────────

const PLATFORM = process.platform   // 'win32' | 'linux' | 'darwin'
const ARCH     = process.arch       // 'x64' | 'arm64'

const RELEASE_BASE = `https://github.com/rhasspy/piper/releases/download/${VERSION}`

const PIPER_ASSET = (() => {
  if (PLATFORM === 'win32')                    return { file: 'piper_windows_amd64.zip',       ext: 'zip' }
  if (PLATFORM === 'linux'  && ARCH === 'x64') return { file: 'piper_linux_x86_64.tar.gz',     ext: 'tar.gz' }
  if (PLATFORM === 'linux'  && ARCH === 'arm64') return { file: 'piper_linux_aarch64.tar.gz',  ext: 'tar.gz' }
  if (PLATFORM === 'darwin' && ARCH === 'arm64') return { file: 'piper_macos_aarch64.tar.gz',  ext: 'tar.gz' }
  if (PLATFORM === 'darwin' && ARCH === 'x64')  return { file: 'piper_macos_x64.tar.gz',       ext: 'tar.gz' }
  throw new Error(`Unsupported platform: ${PLATFORM} ${ARCH}`)
})()

const PIPER_BIN = PLATFORM === 'win32' ? 'piper.exe' : 'piper'

// ── Model catalogue ───────────────────────────────────────────────────────────

const MODELS = {
  sw: {
    name: 'sw_CD-lanfrica-medium',
    base: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/sw/sw_CD/lanfrica/medium',
  },
  en: {
    name: 'en_US-lessac-medium',
    base: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium',
  },
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const langArg = process.argv.indexOf('--lang')
const LANG    = langArg !== -1 ? process.argv[langArg + 1] : 'sw'

if (!MODELS[LANG]) {
  console.error(`Unknown language "${LANG}". Available: ${Object.keys(MODELS).join(', ')}`)
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })

// ── Helpers ───────────────────────────────────────────────────────────────────

async function downloadFile(url, destPath) {
  if (existsSync(destPath)) {
    console.log(`  ✓ already exists: ${destPath}`)
    return
  }
  console.log(`  ↓ downloading: ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`)
  await pipeline(res.body, createWriteStream(destPath))
  console.log(`  ✓ saved`)
}

function extractTarGz(archivePath, outDir) {
  console.log(`  📦 extracting ${archivePath}...`)
  const result = spawnSync('tar', ['xzf', archivePath, '-C', outDir, '--strip-components=1'], {
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error(`tar failed with exit code ${result.status}`)
}

function extractZip(archivePath, outDir) {
  console.log(`  📦 extracting ${archivePath}...`)
  // Use PowerShell on Windows (always available)
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-Command',
     `Expand-Archive -Force -Path "${archivePath}" -DestinationPath "${outDir}_tmp"`,
    ],
    { stdio: 'inherit' }
  )
  if (result.status !== 0) throw new Error(`PowerShell Expand-Archive failed`)

  // piper.exe lives in piper/ subfolder inside the zip
  const inner = join(outDir + '_tmp', 'piper', 'piper.exe')
  if (existsSync(inner)) {
    renameSync(inner, join(outDir, 'piper.exe'))
    rmSync(outDir + '_tmp', { recursive: true, force: true })
  } else {
    throw new Error(`piper.exe not found inside extracted zip at ${inner}`)
  }
}

// ── Step 1: Download and extract Piper binary ─────────────────────────────────

console.log(`\n[Piper] Platform: ${PLATFORM} ${ARCH}`)
console.log(`[Piper] Asset:    ${PIPER_ASSET.file}`)
console.log(`[Piper] Output:   ${OUT_DIR}\n`)

const binPath = join(OUT_DIR, PIPER_BIN)

if (existsSync(binPath)) {
  console.log(`[Piper] Binary already present: ${binPath}`)
} else {
  const tmpArchive = join(tmpdir(), `piper_${randomUUID()}.${PIPER_ASSET.ext}`)
  try {
    await downloadFile(`${RELEASE_BASE}/${PIPER_ASSET.file}`, tmpArchive)

    if (PIPER_ASSET.ext === 'tar.gz') {
      extractTarGz(tmpArchive, OUT_DIR)
    } else {
      await extractZip(tmpArchive, OUT_DIR)
    }

    // Make binary executable on Unix
    if (PLATFORM !== 'win32') {
      chmodSync(binPath, 0o755)
      console.log(`  ✓ chmod +x ${binPath}`)
    }
  } finally {
    // Clean up temp archive
    try { unlinkSync(tmpArchive) } catch { /* ignore */ }
  }
}

// ── Step 2: Download model ────────────────────────────────────────────────────

const model = MODELS[LANG]
console.log(`\n[Piper] Downloading model: ${model.name} (${LANG})`)

try {
  await downloadFile(
    `${model.base}/${model.name}.onnx`,
    join(OUT_DIR, `${model.name}.onnx`)
  )
  await downloadFile(
    `${model.base}/${model.name}.onnx.json`,
    join(OUT_DIR, `${model.name}.onnx.json`)
  )
} catch (e) {
  console.error(`\n  ✗ Model download failed: ${e.message}`)
  console.error(`  Manual download: https://huggingface.co/rhasspy/piper-voices`)
  console.error(`  Place .onnx + .onnx.json inside: ${OUT_DIR}`)
  process.exit(1)
}

// ── Done ──────────────────────────────────────────────────────────────────────

console.log(`\n✅ Piper is ready in: ${OUT_DIR}`)
console.log(`   Binary : ${PIPER_BIN}`)
console.log(`   Model  : ${model.name}.onnx`)
console.log(`\nTo test: echo "Habari yako" | ${binPath} --model ${join(OUT_DIR, model.name + '.onnx')} --output_file /tmp/test.wav && aplay /tmp/test.wav\n`)
