/**
 * Automatic daily database backup.
 *
 * - Runs once at startup (catches up if the PC was off at midnight).
 * - Schedules itself to run again at the next midnight, then every 24 h.
 * - Keeps the 30 most recent backup files; older ones are pruned automatically.
 * - Uses better-sqlite3's native .backup() so the copy is always consistent
 *   even while the DB is actively being written to.
 *
 * Backup location:  <userData>/backups/queue-backup-YYYY-MM-DD.db
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { getDb } from './ipc'

const KEEP_DAYS = 30

function getBackupDir(): string {
  return join(app.getPath('userData'), 'backups')
}

function performBackup(): void {
  const backupDir = getBackupDir()
  mkdirSync(backupDir, { recursive: true })

  const timestamp = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const backupPath = join(backupDir, `queue-backup-${timestamp}.db`)

  if (existsSync(backupPath)) {
    // Already backed up today — skip (can happen on rapid restart)
    return
  }

  const db = getDb()
  db.backup(backupPath)
    .then(() => {
      console.log(`[Backup] Database saved → ${backupPath}`)
      pruneOldBackups(backupDir)
    })
    .catch((e: Error) => {
      console.error('[Backup] Failed:', e.message)
    })
}

function pruneOldBackups(backupDir: string): void {
  try {
    const files = readdirSync(backupDir)
      .filter((f) => f.startsWith('queue-backup-') && f.endsWith('.db'))
      .sort() // ISO date names sort chronologically — oldest first

    const excess = files.length - KEEP_DAYS
    if (excess > 0) {
      for (const f of files.slice(0, excess)) {
        try { unlinkSync(join(backupDir, f)) } catch { /* ignore */ }
      }
      console.log(`[Backup] Pruned ${excess} old backup(s)`)
    }
  } catch { /* ignore */ }
}

export function scheduleDbBackup(): void {
  // Run once now so the very first day of deployment is covered
  performBackup()

  // Schedule next run at 00:01 tomorrow, then repeat every 24 h
  const now = new Date()
  const nextRun = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 1, 0, 0)
  const msUntilNextRun = nextRun.getTime() - now.getTime()

  setTimeout(() => {
    performBackup()
    setInterval(performBackup, 24 * 60 * 60 * 1000)
  }, msUntilNextRun)

  console.log(`[Backup] Next backup scheduled in ${Math.round(msUntilNextRun / 1000 / 60)} minutes`)
}
