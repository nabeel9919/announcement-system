/**
 * Video manager — stores educational/promotional videos in userData/videos/.
 * Handles file copy (from any location), list, delete, and playlist order.
 * Playlist order is persisted in config.json under `videoPlaylist`.
 */

import { app, dialog } from 'electron'
import { join, basename, extname } from 'path'
import { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, statSync } from 'fs'
import { readLocalConfig, writeLocalConfig } from './license'

const SUPPORTED_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi'])

export function getVideosDir(): string {
  const dir = join(app.getPath('userData'), 'videos')
  mkdirSync(dir, { recursive: true })
  return dir
}

export interface VideoEntry {
  name: string      // filename e.g. "health_tips.mp4"
  filePath: string  // absolute path — use file:// prefix in renderer
  size: number      // bytes
  order: number     // position in playlist (0-based)
}

export function listVideos(): VideoEntry[] {
  const dir = getVideosDir()
  const config = readLocalConfig()
  const playlist: string[] = (config as any).videoPlaylist ?? []

  const files = readdirSync(dir).filter((f) => SUPPORTED_EXTS.has(extname(f).toLowerCase()))

  // Build ordered list: known order first, then any new files appended
  const ordered: string[] = [
    ...playlist.filter((name) => files.includes(name)),
    ...files.filter((f) => !playlist.includes(f)),
  ]

  return ordered.map((name, i) => {
    const filePath = join(dir, name)
    let size = 0
    try { size = statSync(filePath).size } catch { /* ignore */ }
    return { name, filePath, size, order: i }
  })
}

export async function addVideo(): Promise<VideoEntry[] | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select Video File',
    filters: [
      { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi'] },
    ],
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const dir = getVideosDir()
  for (const src of result.filePaths) {
    let dest = join(dir, basename(src))
    // Avoid overwriting — append _1, _2, etc.
    let counter = 1
    while (existsSync(dest)) {
      const ext = extname(basename(src))
      const base = basename(src, ext)
      dest = join(dir, `${base}_${counter}${ext}`)
      counter++
    }
    copyFileSync(src, dest)
  }

  // Save updated playlist order
  savePlaylistOrder(listVideos().map((v) => v.name))
  return listVideos()
}

export function deleteVideo(name: string): VideoEntry[] {
  const dir = getVideosDir()
  const filePath = join(dir, name)
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
  // Remove from playlist
  const playlist: string[] = ((readLocalConfig() as any).videoPlaylist ?? []).filter((n: string) => n !== name)
  savePlaylistOrder(playlist)
  return listVideos()
}

export function reorderVideos(orderedNames: string[]): VideoEntry[] {
  savePlaylistOrder(orderedNames)
  return listVideos()
}

function savePlaylistOrder(names: string[]) {
  writeLocalConfig({ videoPlaylist: names } as any)
}
