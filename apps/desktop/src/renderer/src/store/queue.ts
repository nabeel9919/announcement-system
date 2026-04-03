import { create } from 'zustand'
import type { QueueTicket, ServiceWindow, QueueCategory } from '@announcement/shared'

interface QueueStore {
  tickets: QueueTicket[]
  windows: ServiceWindow[]
  categories: QueueCategory[]
  stats: { waiting: number; called: number; served: number; skipped: number }

  // Actions
  setTickets: (tickets: QueueTicket[]) => void
  setWindows: (windows: ServiceWindow[]) => void
  setCategories: (categories: QueueCategory[]) => void
  setStats: (stats: QueueStore['stats']) => void

  addTicket: (ticket: QueueTicket) => void
  updateTicket: (id: string, changes: Partial<QueueTicket>) => void

  // Derived
  waitingTickets: () => QueueTicket[]
  calledTickets: () => QueueTicket[]
  waitingByCategory: (categoryId: string) => QueueTicket[]
}

export const useQueueStore = create<QueueStore>((set, get) => ({
  tickets: [],
  windows: [],
  categories: [],
  stats: { waiting: 0, called: 0, served: 0, skipped: 0 },

  setTickets: (tickets) => set({ tickets }),
  setWindows: (windows) => set({ windows }),
  setCategories: (categories) => set({ categories }),
  setStats: (stats) => set({ stats }),

  addTicket: (ticket) => set((s) => ({ tickets: [...s.tickets, ticket] })),

  updateTicket: (id, changes) =>
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === id ? { ...t, ...changes } : t)),
    })),

  waitingTickets: () => get().tickets.filter((t) => t.status === 'waiting'),
  calledTickets: () => get().tickets.filter((t) => t.status === 'called'),
  waitingByCategory: (categoryId) =>
    get().tickets.filter((t) => t.status === 'waiting' && t.categoryId === categoryId),
}))
