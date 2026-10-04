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
    { key: 'sms_default_prono', value: 'Prono PMUB {date} - {hippodrome} : {nums} (Score de sélection : {score}/100)' },
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

  // Modèles SMS
  const smsTemplates = [
    {
      name: 'Bienvenue nouvel abonné',
      category: 'bienvenue',
      message: `Bienvenue sur IYA PMU!
Envoyez au 3524:
P:Prono du jour
N:Num Fetiche
C:Couple
TOP:Top 4
F:Favoris presse
R:Regret
CB:Combinaisons
CE:Chvx eviter
RESULTAT:Arrivee
SOLDE:Jours restants
Bonne chance!`,
    },
    {
      name: 'Rappel prono disponible',
      category: 'prono',
      message: `IYA PMU - Prono disponible!
Envoyez P au 3524 pour
votre pronostic du jour.
Autres commandes:
N=NumFetiche C=Couple
TOP=Top4 F=Favoris
CB=Combis CE=Eviter
AIDE pour tout voir.`,
    },
    {
      name: 'Campagne promotion',
      category: 'promotion',
      message: `On parle plus trop! Abonnez-
vous a IYA PMU et jouez avec
nos infos LONAB. Envoyez vite
au 3524:
P:Prono  N:Num Fetiche
C:Couple  TOP:Top4
F:Favoris  R:Regret
CB:Combis  CE:Chvx eviter
RESULTAT  SOLDE  AIDE`,
    },
    {
      name: 'Résultats disponibles',
      category: 'resultat',
      message: `IYA PMU - Resultats disponibles!
Envoyez RESULTAT au 3524
pour voir l'arrivee du jour.
Demain un nouveau prono
vous attend. Envoyez P
pour le recevoir.`,
    },
    {
      name: 'Alerte expiration abonnement',
      category: 'expiration',
      message: `Attention! Votre abonnement
IYA PMU expire bientot.
Renouvelez maintenant pour
continuer a recevoir vos
pronostics quotidiens LONAB.
Contactez-nous rapidement.`,
    },
    {
      name: 'Menu commandes complet',
      category: 'general',
      message: `IYA PMU - VOS COMMANDES:
P:Prono#1  R:Regret#2
CB1:Combis 2-6
CB2:Combis 7-11
CB3:Combis 12-16
CB4:Combis 17-20
SCORE:Classement 7 chvx
N:Num Fetiche
C:Couple  TOP:Top4
F:Favoris  CE:Eviter
RESULTAT  SOLDE  AIDE`,
    },
  ];

  for (const tpl of smsTemplates) {
    const existing = await prisma.smsTemplate.findFirst({ where: { name: tpl.name } });
    if (!existing) {
      await prisma.smsTemplate.create({ data: tpl });
    }
  }
  console.log('SMS templates seeded');

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
