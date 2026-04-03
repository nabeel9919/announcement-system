import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding pricing plans...')

  // Clear existing plans
  await prisma.pricingPlan.deleteMany()

  await prisma.pricingPlan.createMany({
    data: [
      {
        name: 'Starter',
        price: 30000,
        currency: 'TZS',
        interval: 'MONTHLY',
        maxWindows: 4,
        maxSites: 1,
        features: [
          'Up to 4 service windows',
          'Ticket & card calling modes',
          'Text-to-speech announcements',
          'Display screen support',
          'Email support',
        ],
        isActive: true,
        isHighlighted: false,
        sortOrder: 1,
      },
      {
        name: 'Professional',
        price: 65000,
        currency: 'TZS',
        interval: 'MONTHLY',
        maxWindows: 12,
        maxSites: 3,
        features: [
          'Up to 12 service windows',
          'All calling modes (ticket, card, name)',
          'Google TTS premium voices',
          'Multi-site support (3 sites)',
          'Analytics dashboard',
          'Priority email support',
        ],
        isActive: true,
        isHighlighted: true,
        sortOrder: 2,
      },
      {
        name: 'Enterprise',
        price: 120000,
        currency: 'TZS',
        interval: 'MONTHLY',
        maxWindows: 50,
        maxSites: 10,
        features: [
          'Unlimited service windows',
          'All calling modes + hybrid',
          'Google TTS premium voices',
          'Multi-site (up to 10 sites)',
          'Full analytics & reporting',
          'Custom branding',
          'Phone & email support',
          'On-site training',
        ],
        isActive: true,
        isHighlighted: false,
        sortOrder: 3,
      },
      {
        name: 'Starter (Yearly)',
        price: 300000,
        currency: 'TZS',
        interval: 'YEARLY',
        yearlyDiscountPercent: 17,
        maxWindows: 4,
        maxSites: 1,
        features: [
          'Up to 4 service windows',
          'Ticket & card calling modes',
          'Text-to-speech announcements',
          'Display screen support',
          '2 months free vs monthly',
          'Email support',
        ],
        isActive: true,
        isHighlighted: false,
        sortOrder: 4,
      },
    ],
  })

  const count = await prisma.pricingPlan.count()
  console.log(`✓ Seeded ${count} pricing plans`)
  console.log('  • Starter:            30,000 TZS/month')
  console.log('  • Professional:       65,000 TZS/month  [Most Popular]')
  console.log('  • Enterprise:        120,000 TZS/month')
  console.log('  • Starter (Yearly):  300,000 TZS/year')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
