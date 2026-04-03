export type BillingInterval = 'monthly' | 'yearly'

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'

export type Currency = 'TZS' | 'USD' | 'EUR' | 'KES' | 'UGX'

/**
 * A pricing plan — fully editable from the admin portal.
 * Price stored in smallest currency unit (TZS has no sub-unit, stored as-is).
 */
export interface PricingPlan {
  id: string
  name: string
  /** Price in full currency units (e.g. 30000 for 30,000 TZS) */
  price: number
  currency: Currency
  interval: BillingInterval
  /** Yearly discount % shown to user (e.g. 17 = save 17%) */
  yearlyDiscountPercent?: number
  features: string[]
  maxWindows: number
  maxSites: number
  isActive: boolean
  isHighlighted: boolean  // "Most Popular" flag
  sortOrder: number
}

export interface Client {
  id: string
  organizationName: string
  contactEmail: string
  contactPhone?: string
  country: string
  city: string
  licenseKey: string
  planId: string
  subscriptionStatus: SubscriptionStatus
  subscriptionStart: string   // ISO
  subscriptionEnd: string     // ISO
  trialEndsAt?: string        // ISO
  createdAt: string           // ISO
  notes?: string
}

export interface Invoice {
  id: string
  clientId: string
  amount: number
  currency: Currency
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'
  issuedAt: string
  dueAt: string
  paidAt?: string
  description: string
}

export interface PaymentSettings {
  /** Editable from admin portal */
  plans: PricingPlan[]
  defaultCurrency: Currency
  trialDays: number
  gracePeriodDays: number
  invoiceDueDays: number
}
