import type { Sector } from '../types/announcement'

export interface SectorPreset {
  sector: Sector
  label: string
  icon: string
  defaultCategories: Array<{
    code: string
    label: string
    color: string
    prefix: string
  }>
  defaultWindowLabels: string[]
  announcementPrefix: string  // TTS prefix before ticket number
}

export const SECTOR_PRESETS: Record<Sector, SectorPreset> = {
  hospital: {
    sector: 'hospital',
    label: 'Hospital',
    icon: '🏥',
    defaultCategories: [
      { code: 'OPD', label: 'Outpatient Department', color: '#3B82F6', prefix: 'OPD ' },
      { code: 'EMG', label: 'Emergency', color: '#EF4444', prefix: 'EMG ' },
      { code: 'PHR', label: 'Pharmacy', color: '#10B981', prefix: 'PHR ' },
      { code: 'LAB', label: 'Laboratory', color: '#8B5CF6', prefix: 'LAB ' },
      { code: 'RAD', label: 'Radiology', color: '#F59E0B', prefix: 'RAD ' },
    ],
    defaultWindowLabels: ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Pharmacy Counter', 'Lab Counter'],
    announcementPrefix: 'Attention please,',
  },
  airport: {
    sector: 'airport',
    label: 'Airport',
    icon: '✈️',
    defaultCategories: [
      { code: 'CHK', label: 'Check-in', color: '#3B82F6', prefix: 'CHK ' },
      { code: 'IMG', label: 'Immigration', color: '#8B5CF6', prefix: 'IMG ' },
      { code: 'SEC', label: 'Security', color: '#EF4444', prefix: 'SEC ' },
      { code: 'INF', label: 'Information', color: '#10B981', prefix: 'INF ' },
    ],
    defaultWindowLabels: ['Gate 1', 'Gate 2', 'Gate 3', 'Counter A', 'Counter B', 'Counter C'],
    announcementPrefix: 'Passengers attention,',
  },
  bank: {
    sector: 'bank',
    label: 'Bank',
    icon: '🏦',
    defaultCategories: [
      { code: 'A', label: 'General Services', color: '#3B82F6', prefix: 'A-' },
      { code: 'B', label: 'Premium Services', color: '#F59E0B', prefix: 'B-' },
      { code: 'C', label: 'Business Banking', color: '#10B981', prefix: 'C-' },
    ],
    defaultWindowLabels: ['Teller 1', 'Teller 2', 'Teller 3', 'Teller 4', 'Customer Service'],
    announcementPrefix: 'Dear customer,',
  },
  court: {
    sector: 'court',
    label: 'Court',
    icon: '⚖️',
    defaultCategories: [
      { code: 'A', label: 'Filing', color: '#6B7280', prefix: 'A-' },
      { code: 'B', label: 'Hearing', color: '#3B82F6', prefix: 'B-' },
      { code: 'C', label: 'Records', color: '#10B981', prefix: 'C-' },
    ],
    defaultWindowLabels: ['Counter 1', 'Counter 2', 'Counter 3', 'Courtroom 1', 'Courtroom 2'],
    announcementPrefix: 'Please be advised,',
  },
  pharmacy: {
    sector: 'pharmacy',
    label: 'Pharmacy',
    icon: '💊',
    defaultCategories: [
      { code: 'A', label: 'General', color: '#10B981', prefix: 'A-' },
      { code: 'B', label: 'Insurance', color: '#3B82F6', prefix: 'B-' },
    ],
    defaultWindowLabels: ['Counter 1', 'Counter 2', 'Counter 3'],
    announcementPrefix: 'Attention,',
  },
  government: {
    sector: 'government',
    label: 'Government Office',
    icon: '🏛️',
    defaultCategories: [
      { code: 'A', label: 'General Services', color: '#3B82F6', prefix: 'A-' },
      { code: 'B', label: 'Applications', color: '#8B5CF6', prefix: 'B-' },
      { code: 'C', label: 'Inquiries', color: '#10B981', prefix: 'C-' },
    ],
    defaultWindowLabels: ['Window 1', 'Window 2', 'Window 3', 'Window 4'],
    announcementPrefix: 'Attention please,',
  },
  immigration: {
    sector: 'immigration',
    label: 'Immigration Office',
    icon: '🛂',
    defaultCategories: [
      { code: 'CTZ', label: 'Citizens', color: '#10B981', prefix: 'CTZ ' },
      { code: 'RST', label: 'Residents', color: '#3B82F6', prefix: 'RST ' },
      { code: 'VST', label: 'Visitors', color: '#F59E0B', prefix: 'VST ' },
    ],
    defaultWindowLabels: ['Lane 1', 'Lane 2', 'Lane 3', 'Lane 4', 'Lane 5'],
    announcementPrefix: 'Passengers,',
  },
  supermarket: {
    sector: 'supermarket',
    label: 'Supermarket / Retail',
    icon: '🛒',
    defaultCategories: [
      { code: 'A', label: 'General', color: '#3B82F6', prefix: 'A-' },
      { code: 'B', label: 'Deli Counter', color: '#F59E0B', prefix: 'B-' },
    ],
    defaultWindowLabels: ['Counter 1', 'Counter 2', 'Counter 3', 'Counter 4'],
    announcementPrefix: 'Attention shoppers,',
  },
  clinic: {
    sector: 'clinic',
    label: 'Clinic',
    icon: '🩺',
    defaultCategories: [
      { code: 'A', label: 'General Consultation', color: '#3B82F6', prefix: 'A-' },
      { code: 'B', label: 'Specialist', color: '#8B5CF6', prefix: 'B-' },
    ],
    defaultWindowLabels: ['Room 1', 'Room 2', 'Room 3', 'Nurse Station'],
    announcementPrefix: 'Attention please,',
  },
  other: {
    sector: 'other',
    label: 'Other',
    icon: '🏢',
    defaultCategories: [
      { code: 'A', label: 'Category A', color: '#3B82F6', prefix: 'A-' },
      { code: 'B', label: 'Category B', color: '#10B981', prefix: 'B-' },
    ],
    defaultWindowLabels: ['Window 1', 'Window 2', 'Window 3'],
    announcementPrefix: 'Attention,',
  },
}
