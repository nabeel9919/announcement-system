export interface KioskOption {
  id: string
  label: string
  /** Optionally route this answer to a specific service window */
  routesToWindowId?: string
}

export interface KioskQuestion {
  id: string
  /** null = applies to all categories */
  categoryId: string | null
  question: string
  /** 'single' = tap-to-select option buttons; 'text' = keyboard input */
  type: 'single' | 'text'
  options: KioskOption[]
  orderIndex: number
  isEnabled: boolean
  /** Only show this question when a previous question had this answer */
  dependsOnQuestionId: string | null
  dependsOnOptionId: string | null
  createdAt: string
}

export interface KioskTerminal {
  id: string
  /** Display number, e.g. 1, 2, 3 */
  number: number
  /** Friendly name shown in settings, e.g. "Kiosk 1" */
  label: string
  /** Physical location, e.g. "Main Entrance" */
  location: string | null
  isEnabled: boolean
  createdAt: string
}

export interface KioskAnswer {
  questionId: string
  /** Full question text (for printing) */
  question: string
  /** Option id — present for 'single' type */
  optionId?: string
  /** Display value (option label or typed text) */
  value: string
  /** Window id to route to — present when the chosen option has routesToWindowId */
  routesToWindowId?: string
}
