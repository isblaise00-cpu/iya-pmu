import { PrismaClient, SubscriberStatus, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
  const now = new Date();

  // Plans
  const plan1 = await prisma.plan.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: 'Mensuel', price: 19.99, durationDays: 30, description: 'Accès pronostics quotidiens pendant 1 mois', isActive: true } });
  const plan2 = await prisma.plan.upsert({ where: { id: 2 }, update: {}, create: { id: 2, name: 'Trimestriel', price: 49.99, durationDays: 90, description: 'Accès pronostics quotidiens pendant 3 mois — économisez 25%', isActive: true } });
  const plan3 = await prisma.plan.upsert({ where: { id: 3 }, update: {}, create: { id: 3, name: 'Annuel', price: 149.99, durationDays: 365, description: 'Accès pronostics quotidiens pendant 1 an — économisez 37%', isActive: true } });

  console.log('Plans created');

  // Subscribers
  const sub1 = await prisma.subscriber.upsert({ where: { phone: '+33612345678' }, update: {}, create: { phone: '+33612345678', name: 'Jean Dupont', status: SubscriberStatus.ACTIVE, planId: plan2.id, startDate: addDays(now, -30), endDate: addDays(now, 60) } });
  const sub2 = await prisma.subscriber.upsert({ where: { phone: '+33623456789' }, update: {}, create: { phone: '+33623456789', name: 'Marie Martin', status: SubscriberStatus.ACTIVE, planId: plan1.id, startDate: addDays(now, -10), endDate: addDays(now, 20) } });
  await prisma.subscriber.upsert({ where: { phone: '+33634567890' }, update: {}, create: { phone: '+33634567890', name: 'Pierre Bernard', status: SubscriberStatus.EXPIRED, planId: plan1.id, startDate: addDays(now, -60), endDate: addDays(now, -30) } });
  await prisma.subscriber.upsert({ where: { phone: '+33645678901' }, update: {}, create: { phone: '+33645678901', name: 'Sophie Leclerc', status: SubscriberStatus.ACTIVE, planId: plan3.id, startDate: addDays(now, -5), endDate: addDays(now, 360) } });
  await prisma.subscriber.upsert({ where: { phone: '+33656789012' }, update: {}, create: { phone: '+33656789012', name: 'Marc Rousseau', status: SubscriberStatus.SUSPENDED, planId: plan1.id, startDate: addDays(now, -15), endDate: addDays(now, 15) } });

  console.log('Subscribers created');

  // Payments
  await prisma.payment.createMany({
    data: [
      { subscriberId: sub1.id, amount: 49.99, planId: plan2.id, note: 'Paiement initial', paymentDate: addDays(now, -30) },
      { subscriberId: sub2.id, amount: 19.99, planId: plan1.id, note: 'Paiement initial', paymentDate: addDays(now, -10) },
    ],
    skipDuplicates: true,
  });

  // Settings
  const defaultSettings = [
    { key: 'scraping_time', value: '07:00' },
    { key: 'sms_default_prono', value: 'Prono PMUB {date} - {hippodrome} : {nums} (Confiance : {confidence}%)' },
    { key: 'sms_expired', value: 'Votre abonnement PMU-PRONO a expiré. Pour renouveler, contactez-nous.' },
    { key: 'sms_unknown', value: "Bonjour ! Vous n'êtes pas abonné à PMU-PRONO. Contactez-nous pour vous abonner." },
    // Multi-sports
    { key: 'football_scraping_time', value: '08:00' },
    { key: 'basketball_scraping_time', value: '08:30' },
    { key: 'football_leagues', value: '39,140,135,78,61,2' },
    { key: 'basketball_leagues', value: '12' },
    { key: 'sms_default_foot', value: 'Prono FOOT {date} - {home} vs {away} ({league}) : {market} | Confiance {confidence}%' },
    { key: 'sms_default_basket', value: 'Prono BASKET {date} - {home} vs {away} ({league}) : {market} | Confiance {confidence}%' },
  ];

  for (const s of defaultSettings) {
    await prisma.setting.upsert({ where: { key: s.key }, update: {}, create: s });
  }

  // Super admin
  const superAdminHash = await bcrypt.hash('azertyuiop', 12);
  await prisma.user.upsert({
    where: { email: 'admin@pmu.com' },
    update: {},
    create: { email: 'admin@pmu.com', passwordHash: superAdminHash, name: 'Super Admin', role: UserRole.SUPER_ADMIN, isActive: true },
  });
  console.log('Super admin created: admin@pmu.com / azertyuiop');

  console.log('Seeding complete!');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
