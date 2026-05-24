import { PrismaClient, SubscriberStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Plans
  const plan1 = await prisma.plan.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'Mensuel',
      price: 19.99,
      durationDays: 30,
      description: 'Accès pronostics quotidiens pendant 1 mois',
      isActive: true,
    },
  });

  const plan2 = await prisma.plan.upsert({
    where: { id: 2 },
    update: {},
    create: {
      id: 2,
      name: 'Trimestriel',
      price: 49.99,
      durationDays: 90,
      description: 'Accès pronostics quotidiens pendant 3 mois — économisez 25%',
      isActive: true,
    },
  });

  const plan3 = await prisma.plan.upsert({
    where: { id: 3 },
    update: {},
    create: {
      id: 3,
      name: 'Annuel',
      price: 149.99,
      durationDays: 365,
      description: 'Accès pronostics quotidiens pendant 1 an — économisez 37%',
      isActive: true,
    },
  });

  console.log('Plans created:', plan1.name, plan2.name, plan3.name);

  // Subscribers
  const now = new Date();
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

  const sub1 = await prisma.subscriber.upsert({
    where: { phone: '+33612345678' },
    update: {},
    create: {
      phone: '+33612345678',
      name: 'Jean Dupont',
      status: SubscriberStatus.ACTIVE,
      planId: plan2.id,
      startDate: addDays(now, -30),
      endDate: addDays(now, 60),
    },
  });

  const sub2 = await prisma.subscriber.upsert({
    where: { phone: '+33623456789' },
    update: {},
    create: {
      phone: '+33623456789',
      name: 'Marie Martin',
      status: SubscriberStatus.ACTIVE,
      planId: plan1.id,
      startDate: addDays(now, -10),
      endDate: addDays(now, 20),
    },
  });

  const sub3 = await prisma.subscriber.upsert({
    where: { phone: '+33634567890' },
    update: {},
    create: {
      phone: '+33634567890',
      name: 'Pierre Bernard',
      status: SubscriberStatus.EXPIRED,
      planId: plan1.id,
      startDate: addDays(now, -60),
      endDate: addDays(now, -30),
    },
  });

  const sub4 = await prisma.subscriber.upsert({
    where: { phone: '+33645678901' },
    update: {},
    create: {
      phone: '+33645678901',
      name: 'Sophie Leclerc',
      status: SubscriberStatus.ACTIVE,
      planId: plan3.id,
      startDate: addDays(now, -5),
      endDate: addDays(now, 360),
    },
  });

  const sub5 = await prisma.subscriber.upsert({
    where: { phone: '+33656789012' },
    update: {},
    create: {
      phone: '+33656789012',
      name: 'Marc Rousseau',
      status: SubscriberStatus.SUSPENDED,
      planId: plan1.id,
      startDate: addDays(now, -15),
      endDate: addDays(now, 15),
    },
  });

  console.log('Subscribers created:', sub1.name, sub2.name, sub3.name, sub4.name, sub5.name);

  // Payments
  await prisma.payment.createMany({
    data: [
      { subscriberId: sub1.id, amount: 49.99, planId: plan2.id, note: 'Paiement initial', paymentDate: addDays(now, -30) },
      { subscriberId: sub2.id, amount: 19.99, planId: plan1.id, note: 'Paiement initial', paymentDate: addDays(now, -10) },
      { subscriberId: sub3.id, amount: 19.99, planId: plan1.id, note: 'Paiement initial', paymentDate: addDays(now, -60) },
      { subscriberId: sub4.id, amount: 149.99, planId: plan3.id, note: 'Paiement annuel', paymentDate: addDays(now, -5) },
    ],
    skipDuplicates: true,
  });

  // Pronostics
  const prono1 = await prisma.pronostic.create({
    data: {
      date: addDays(now, -1),
      baseHorse: 'N°3 - SULTAN DU DESERT',
      tierce: ['N°3', 'N°7', 'N°11'],
      quarte: ['N°3', 'N°7', 'N°11', 'N°5'],
      quinte: ['N°3', 'N°7', 'N°11', 'N°5', 'N°14'],
      outsider: 'N°9 - FLASH ROYAL',
      confidenceScore: 78,
      commentary: 'SULTAN DU DESERT présente une forme excellente avec 2 victoires en 3 dernières sorties. Conditions de terrain favorables. Flash Royal en outsider car revient de blessure mais entraîneur confiant.',
      isSent: true,
      rawData: { sources: ['canalturf', 'zone-turf'], scrapedAt: addDays(now, -1).toISOString() },
    },
  });

  await prisma.result.create({
    data: {
      date: addDays(now, -1),
      arrivalOrder: ['N°7', 'N°3', 'N°11', 'N°14', 'N°5'],
      source: 'pmu.fr',
      pronosticId: prono1.id,
    },
  });

  const prono2 = await prisma.pronostic.create({
    data: {
      date: now,
      baseHorse: 'N°1 - EMPIRE DE LUMIERE',
      tierce: ['N°1', 'N°4', 'N°8'],
      quarte: ['N°1', 'N°4', 'N°8', 'N°12'],
      quinte: ['N°1', 'N°4', 'N°8', 'N°12', 'N°6'],
      outsider: 'N°15 - COUP DE FOUDRE',
      confidenceScore: 65,
      commentary: "EMPIRE DE LUMIERE est le favori logique de cette épreuve. Cote de 3.5 mais mérite d'être joué. COUP DE FOUDRE en outsider car distance lui convient parfaitement.",
      isSent: false,
      rawData: { sources: ['canalturf', 'zone-turf', 'equidia'], scrapedAt: now.toISOString() },
    },
  });

  console.log('Pronostics created:', prono1.id, prono2.id);

  // Settings
  const defaultSettings = [
    { key: 'scraping_time', value: '07:00' },
    { key: 'results_fetch_time', value: '18:00' },
    { key: 'sms_default_prono', value: '🏇 PRONOSTIC PMU du {date}\n🐴 Base: {base}\n🎯 Tiercé: {tierce}\n🎲 Quarté: {quarte}\n🔥 Quinté: {quinte}\n⚡ Outsider: {outsider}\n✅ Confiance: {score}/100' },
    { key: 'sms_expired', value: 'Votre abonnement PMU-PRONO a expiré. Pour renouveler, contactez-nous ou envoyez RENOUVELER.' },
    { key: 'sms_unknown', value: "Bonjour ! Vous n'êtes pas abonné à PMU-PRONO. Pour recevoir nos pronostics quotidiens, contactez-nous." },
    { key: 'anthropic_model', value: 'claude-sonnet-4-20250514' },
  ];

  for (const s of defaultSettings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }

  console.log('Settings initialized');
  console.log('Seeding complete!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
