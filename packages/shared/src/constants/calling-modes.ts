import type { CallingMode } from '../types/queue'

export interface CallingModeInfo {
  mode: CallingMode
  label: string
  description: string
  features: string[]
  ttsExamples: string[]
}

export const CALLING_MODES: Record<CallingMode, CallingModeInfo> = {
  ticket: {
    mode: 'ticket',
    label: 'Ticket / Number System',
    description:
      'System generates sequential numbered tickets. Operator calls the next number with one click.',
    features: [
      'Auto-increment numbering per category',
      'Optional thermal printer for ticket slips',
      'Multi-category support (A, B, C...)',
      'VIP / Priority queue',
    ],
    ttsExamples: [
      'A-zero-one-seven, please proceed to Window Two',
      'B-zero-zero-four, please proceed to Teller Three',
    ],
  },
  card: {
    mode: 'card',
    label: 'Physical Card Calling',
    description:
      'Patients or passengers hold a printed card (e.g. "OPD K 11"). Operator enters or selects the card code to announce it.',
    features: [
      'Operator reads physical card and enters code',
      'Supports any card format (OPD K 11, B-22, Gate 3 Row C)',
      'Optional barcode scanner for faster entry',
      'Card history log per session',
    ],
    ttsExamples: [
      'O-P-D, K, Eleven — please proceed to Room Three',
      'Pharmacy, B, Twenty-Two — please come to the counter',
    ],
  },
  name: {
    mode: 'name',
    label: 'Live Name Calling',
    description:
      'Operator types a patient or passenger name. The system announces it via text-to-speech immediately.',
    features: [
      'Free-text name entry with fast-complete',
      'Phonetic override for difficult names',
      'Multi-language TTS per announcement',
      'Repeat button for missed calls',
    ],
    ttsExamples: [
      'Mr. Ahmed Hassan, please proceed to Room One',
      'Mama Zawadi Juma, tafadhali njooni counter namba mbili',
    ],
  },
  hybrid: {
    mode: 'hybrid',
    label: 'Hybrid Mode',
    description:
      'Combine all modes in one session. Use ticket mode for walk-ins, name mode for appointments, card mode for card holders.',
    features: [
      'Switch between modes per call',
      'Unified queue dashboard',
      'All features from all modes available',
      'Recommended for hospitals and airports',
    ],
    ttsExamples: [
      'A-zero-zero-three, please proceed to Window Two',
      'Dr. appointment for Mr. Baraka Mwangi — Room Four please',
    ],
  },
}

export const DEFAULT_BILLING = {
  currency: 'TZS' as const,
  monthlyPrice: 30000,
  yearlyPrice: 300000, // 2 months free
  trialDays: 14,
  gracePeriodDays: 7,
}
