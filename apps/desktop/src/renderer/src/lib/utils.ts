import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString('en-TZ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-TZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function generateId(): string {
  return crypto.randomUUID()
}

/** Pad number with leading zeros e.g. 3 → "003" */
export function padNumber(n: number, digits = 3): string {
  return String(n).padStart(digits, '0')
}

/** Format TZS currency */
export function formatTZS(amount: number): string {
  return `TZS ${amount.toLocaleString('en-TZ')}`
}

/** Minutes since a date string */
export function minutesSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000)
}
