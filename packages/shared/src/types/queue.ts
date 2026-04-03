export type CallingMode = 'ticket' | 'card' | 'name' | 'hybrid'

export type TicketStatus = 'waiting' | 'called' | 'served' | 'skipped' | 'no_show'

export interface QueueCategory {
  id: string
  code: string         // e.g. "A", "OPD", "PHARMACY", "GATE"
  label: string        // e.g. "General", "Outpatient Department"
  windowIds: string[]  // which windows serve this category
  color: string        // hex for UI display e.g. "#3B82F6"
  prefix: string       // printed on ticket e.g. "A-", "OPD "
}

/**
 * Represents one queue ticket — either system-generated (ticket mode)
 * or entered by operator from a physical card (card mode).
 */
export interface QueueTicket {
  id: string
  /** Display number e.g. "A-017", "OPD K 11", "B-003" */
  displayNumber: string
  /** Raw number for sorting e.g. 17 */
  sequenceNumber: number
  categoryId: string
  status: TicketStatus
  createdAt: string   // ISO string
  calledAt?: string
  servedAt?: string
  /** Which window/counter served this ticket */
  windowId?: string
  /** For name-call mode: the name to announce */
  calleeName?: string
  /** Number of times recalled */
  recallCount: number
}

export interface ServiceWindow {
  id: string
  number: number
  /** Human label shown on display screen e.g. "Window 2", "Counter B", "Room 3" */
  label: string
  operatorName?: string
  isActive: boolean
  /** Currently serving ticket id */
  currentTicketId?: string
}

export interface QueueStats {
  waiting: number
  called: number
  served: number
  skipped: number
  avgWaitMinutes: number
  peakHour: number | null
}

export interface CallEvent {
  ticketId: string
  windowId: string
  calledAt: string
  type: 'initial' | 'recall'
}
