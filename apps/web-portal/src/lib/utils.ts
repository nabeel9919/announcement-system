import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTZS(amount: number): string {
  return `TZS ${amount.toLocaleString('en-TZ')}`
}

export function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-TZ', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

const API_URL = process.env.NEXT_PUBLIC_LICENSE_SERVER_URL ?? 'http://localhost:3001'

export async function apiFetch(path: string, options?: RequestInit) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}
