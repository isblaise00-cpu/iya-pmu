import { prisma } from '../lib/prisma';
import { smsAdapter } from '../adapters/sms.adapter';
import { logger } from '../lib/logger';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { renderHippiqueSms } from '../lib/hippique-sms';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers internes
// ──────────────────────────────────────────────────────────────────────────────

async function getTodayPronostic() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return prisma.pronostic.findFirst({
    where: { date: { gte: today } },
    orderBy: { date: 'desc' },
    include: { race: true },
  });
}

/** Retourne les chevaux triés par nombre de citations dans les 200 combinaisons.
 *  Chaque élément : { num, nom, count } */
function rankByFrequency(prono: any): { num: number; nom: string; count: number }[] {
  const proposals: any[] = ((prono.proposals as any[]) || []).filter((p: any) => !p.id?.startsWith('hist_'));
  const horses: any[] = (prono.horses as any[]) || [];
  const freq = new Map<number, number>();
  for (const p of proposals) {
    for (const n of (p.nums as number[] || [])) {
      freq.set(n, (freq.get(n) ?? 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([num, count]) => {
      const h = horses.find((x: any) => x.num === num);
      return { num, nom: h?.nom ?? `No.${num}`, count };
    });
}

/** Retourne le type de course formaté (ex: "4+1", "QUARTE", "TIERCE"). */
function raceType(prono: any): string {
  return (prono.race as any)?.raceType ?? '';
}

/** Construit l'en-tête avec type de course et date sur une ligne, contenu sur la suivante. */
function header(label: string, type: string, ds: string): string {
  return type ? `${label} ${type} du ${ds}:` : `${label} ${ds}:`;
}

/** Normalise le numéro de téléphone : toujours avec préfixe +. */
function normalizePhone(phone: string): string {
  return phone.startsWith('+') ? phone : '+' + phone;
}

// ──────────────────────────────────────────────────────────────────────────────
// Résolution des commandes SMS entrantes
// ──────────────────────────────────────────────────────────────────────────────

const COMMAND_ALIASES: Record<string, string> = {
  // Pronostic principal (#1)
  'P': 'PRONO', 'PRONO': 'PRONO',
  // Numéro fétiche
  'N': 'NUM', 'NUM': 'NUM',
  // Couple (2 plus cités)
  'C': 'COUPLE', 'COUPLE': 'COUPLE',
  // Top 4 plus cités
  'TOP': 'TOP', 'TOP4': 'TOP',
  // Favoris cotes
  'F': 'FAVORIS', 'FAVORIS': 'FAVORIS', 'F8': 'FAVORIS',
  // Regret (combi #2)
  'R': 'REGRET', 'REGRET': 'REGRET',
  // Combinaisons — CB1 à CB40 (5 combis par page, 200 au total)
  'CB': 'COMBI_1', 'CB1': 'COMBI_1', 'COMBI': 'COMBI_1', 'COMB': 'COMBI_1',
  // Chevaux à éviter
  'CE': 'EVITER', 'EVITER': 'EVITER',
  // Résultats
  'RESULTAT': 'RESULTAT', 'RESULTATS': 'RESULTAT',
  // Solde
  'SOLDE': 'SOLDE',
  // Aide
  'AIDE': 'AIDE', 'HELP': 'AIDE', 'X': 'AIDE',
};
// CB2 à CB40 générés dynamiquement
for (let i = 2; i <= 40; i++) COMMAND_ALIASES[`CB${i}`] = `COMBI_${i}`;

async function resolveCommand(command: string, subscriber: any): Promise<string> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ds = format(today, 'dd/MM', { locale: fr });

  // Handle COMBI_N dynamically (N = 1..40, 5 combis par page, 200 combis au total)
  if (command.startsWith('COMBI_')) {
    const prono = await getTodayPronostic();
    if (!prono) return `Aucun prono disponible le ${ds}.`;
    const proposals = ((prono.proposals as any[]) || []).filter((p: any) => !p.id?.startsWith('hist_'));
    const page = parseInt(command.split('_')[1], 10);
    const startIdx = (page - 1) * 5;
    const slice = proposals.slice(startIdx, startIdx + 5);
    if (!slice.length) return `Aucune combinaison disponible pour la page ${page}.`;
    const from = startIdx + 1;
    const to = startIdx + slice.length;
    const lines = slice.map((p: any, i: number) => `${startIdx + i + 1}: ${(p.nums as number[]).join('-')}`);
    return `${header('COMBIS', raceType(prono), ds)} (${from}-${to}):\n${lines.join('\n')}`;
  }

  switch (command) {

    // ── Prono du jour ─────────────────────────────────────────────────────────
    case 'PRONO': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}. Reessayez plus tard.`;
      const proposals = (prono.proposals as any[]) || [];
      const main = proposals.find((p: any) => p.id === 'prono_du_jour') || proposals[0];
      if (!main) return 'Prono non disponible.';
      return `${header('PRONO', raceType(prono), ds)}\n${(main.nums as number[]).join('-')}`;
    }

    // ── Numéro fétiche — cheval le plus cité sur les 200 combis ──────────────
    case 'NUM': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const ranked = rankByFrequency(prono);
      if (!ranked.length) return 'Numero fetiche non disponible.';
      const best = ranked[0];
      return `${header('NUM FETICHE', raceType(prono), ds)}\nNo.${best.num} ${best.nom.split(' ')[0]} (${best.count} combis)`;
    }

    // ── Couple — 2 chevaux les plus cités ────────────────────────────────────
    case 'COUPLE': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const ranked = rankByFrequency(prono);
      if (ranked.length < 2) return 'Couple non disponible.';
      const [a, b] = ranked;
      return `${header('COUPLE', raceType(prono), ds)}\nNo.${a.num} ${a.nom.split(' ')[0]} + No.${b.num} ${b.nom.split(' ')[0]}`;
    }

    // ── Top 4 — 4 chevaux les plus cités ─────────────────────────────────────
    case 'TOP': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const ranked = rankByFrequency(prono);
      const top4 = ranked.slice(0, 4);
      if (!top4.length) return 'Classement non disponible.';
      const lines = top4.map((h, i) => `${i + 1}.No${h.num} ${h.nom.split(' ')[0]} (${h.count})`);
      return `${header('TOP4', raceType(prono), ds)}\n${lines.join('\n')}`;
    }

    // ── Favoris — 4 chevaux avec les plus petites cotes ──────────────────────
    case 'FAVORIS': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const horses: any[] = (prono.horses as any[]) || [];
      const sorted = [...horses]
        .filter((h: any) => !h.non_partant && h.cote_pt)
        .sort((a: any, b: any) => parseFloat(a.cote_pt) - parseFloat(b.cote_pt))
        .slice(0, 4);
      if (!sorted.length) return 'Favoris non disponibles.';
      const lines = sorted.map((h: any, i: number) => `${i + 1}.No${h.num} ${h.nom.split(' ')[0]} (${h.cote_pt})`);
      return `${header('FAVORIS', raceType(prono), ds)}\n${lines.join('\n')}`;
    }

    // ── Regret : 2e meilleure combinaison ────────────────────────────────────
    case 'REGRET': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const proposals = (prono.proposals as any[]) || [];
      const regret = proposals[1];
      if (!regret) return 'Aucune combinaison alternative disponible.';
      return `${header('REGRET', raceType(prono), ds)}\n${(regret.nums as number[]).join('-')}`;
    }

    // ── Chevaux à éviter — peu cités + longues cotes ─────────────────────────
    case 'EVITER': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const ranked = rankByFrequency(prono);
      const topNums = new Set(ranked.slice(0, 5).map((h) => h.num));
      const horses: any[] = (prono.horses as any[]) || [];
      const toAvoid = [...horses]
        .filter((h: any) => !h.non_partant && !topNums.has(h.num) && h.cote_pt)
        .sort((a: any, b: any) => parseFloat(b.cote_pt) - parseFloat(a.cote_pt))
        .slice(0, 4);
      if (!toAvoid.length) return `Pas de chevaux a eviter identifies le ${ds}.`;
      const list = toAvoid.map((h: any) => `No.${h.num} ${h.nom.split(' ')[0]}(${h.cote_pt})`).join(', ');
      return `EVITER ${ds}: ${list}`;
    }

    // ── Résultat du jour ──────────────────────────────────────────────────────
    case 'RESULTAT': {
      const result = await prisma.result.findFirst({ orderBy: { date: 'desc' } });
      if (!result) return 'Aucun resultat disponible.';
      const arr = Array.isArray(result.arrivalOrder)
        ? (result.arrivalOrder as any[]).join('-')
        : String(result.arrivalOrder ?? '');
      return `ARRIVEE ${format(result.date, 'dd/MM', { locale: fr })}: ${arr}`;
    }

    // ── Solde abonnement ──────────────────────────────────────────────────────
    case 'SOLDE': {
      if (!subscriber) return "Vous n'etes pas abonne. Envoyez AIDE pour la liste des commandes.";
      const daysLeft = Math.ceil((subscriber.endDate.getTime() - Date.now()) / 86400000);
      return `Abonnement: ${daysLeft}j restants. Exp: ${format(subscriber.endDate, 'dd/MM/yy', { locale: fr })}`;
    }

    // ── Aide ──────────────────────────────────────────────────────────────────
    case 'AIDE':
      return [
        'IYA PMU - COMMANDES:',
        'P=Prono du jour',
        'R=Regret (2e combi)',
        'CB1=Combis 1-5  CB2=6-10',
        'CB3=11-15 ... CB40=196-200',
        'N=NumFetiche  C=Couple',
        'TOP=Top4  F=Favoris',
        'CE=Eviter  RESULTAT  SOLDE',
      ].join('\n');

    default:
      return 'Commande non reconnue. Envoyez AIDE pour la liste.';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Point d'entrée principal : SMS entrant
// ──────────────────────────────────────────────────────────────────────────────

export async function handleIncomingSms(phone: string, body: string) {
  const normalized = normalizePhone(phone);
  const raw = body.trim().toUpperCase();
  const command = COMMAND_ALIASES[raw] ?? raw;

  // Cherche l'abonné avec ou sans préfixe + (robustesse format)
  const subscriber = await prisma.subscriber.findFirst({
    where: {
      OR: [
        { phone: normalized },
        { phone: phone },
        { phone: phone.replace(/^\+/, '') },
      ],
    },
    include: { plan: true },
  });

  let responseMessage: string;
  try {
    responseMessage = await resolveCommand(command, subscriber);
  } catch (err: any) {
    logger.error(`[SMS] Erreur résolution commande "${command}": ${err.message}`);
    responseMessage = 'Erreur temporaire. Reessayez dans quelques instants.';
  }

  logger.info(`[SMS IN] ${normalized} → "${raw}" → réponse: ${responseMessage.slice(0, 60)}...`);

  await smsAdapter.send({ to: normalized, message: responseMessage });
  await prisma.smsLog.create({
    data: {
      subscriberId: subscriber?.id ?? null,
      message: responseMessage,
      status: 'SENT',
    },
  });

  return { handled: true, response: responseMessage };
}

// ──────────────────────────────────────────────────────────────────────────────
// Envoi sortant : pronostic hippique à tous les abonnés actifs
// ──────────────────────────────────────────────────────────────────────────────

export async function sendSmsToSubscriber(subscriberId: number, message: string, campaignId?: number) {
  const subscriber = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
  if (!subscriber) throw new Error('Subscriber not found');

  const result = await smsAdapter.send({ to: subscriber.phone, message });

  await prisma.smsLog.create({
    data: {
      subscriberId,
      message,
      status: result.success ? 'SENT' : 'FAILED',
      campaignId: campaignId ?? null,
      errorMessage: result.error ?? null,
    },
  });

  return result;
}

export async function sendPronosticToActiveSubscribers(pronosticId: number) {
  const pronostic = await prisma.pronostic.findUnique({
    where: { id: pronosticId },
    include: { race: true },
  });
  if (!pronostic) throw new Error('Pronostic not found');

  const templateSetting = await prisma.setting.findUnique({ where: { key: 'sms_default_prono' } });
  const hippodrome = (pronostic.race as any)?.hippodrome ?? '';
  const ds = format(pronostic.date, 'dd/MM/yyyy', { locale: fr });

  // Toutes les combinaisons disponibles (hors hist_)
  const proposals = ((pronostic.proposals as any[]) || []).filter((p: any) => !p.id?.startsWith('hist_'));
  if (!proposals.length) throw new Error('Aucune combinaison disponible');

  const activeSubscribers = await prisma.subscriber.findMany({ where: { status: 'ACTIVE' } });

  // Round-robin : chaque abonné reçoit une combinaison différente dans l'ordre
  const results = await Promise.all(activeSubscribers.map((sub, i) => {
    const combo = proposals[i % proposals.length];
    const nums = (combo.nums as number[]).join(' - ');
    const message = renderHippiqueSms(templateSetting?.value, { date: ds, hippodrome, nums });
    return sendSmsToSubscriber(sub.id, message);
  }));

  await prisma.pronostic.update({ where: { id: pronosticId }, data: { isSent: true } });

  const sent = results.filter((r) => r.success).length;
  logger.info(`Pronostic envoyé (round-robin) à ${sent}/${activeSubscribers.length} abonnés`);
  return { total: activeSubscribers.length, sent, failed: activeSubscribers.length - sent };
}

export async function sendPronosticToOneSubscriber(pronosticId: number, subscriberId: number) {
  const pronostic = await prisma.pronostic.findUnique({
    where: { id: pronosticId },
    include: { race: true },
  });
  if (!pronostic) throw new Error('Pronostic introuvable');

  const subscriber = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
  if (!subscriber) throw new Error('Abonné introuvable');

  const templateSetting = await prisma.setting.findUnique({ where: { key: 'sms_default_prono' } });
  const proposals = ((pronostic.proposals as any[]) || []).filter((p: any) => !p.id?.startsWith('hist_'));
  const combo = proposals[0];
  const nums = (combo?.nums as number[] || []).join(' - ');
  const hippodrome = (pronostic.race as any)?.hippodrome ?? '';

  const message = renderHippiqueSms(templateSetting?.value, {
    date: format(pronostic.date, 'dd/MM/yyyy', { locale: fr }),
    hippodrome, nums,
  });

  const result = await sendSmsToSubscriber(subscriber.id, message);
  return { success: result.success, error: result.error ?? null };
}

export async function sendResultToActiveSubscribers(resultId: number) {
  const result = await (prisma.result as any).findUnique({
    where: { id: resultId },
    include: { pronostic: { include: { race: true } } },
  });
  if (!result) throw new Error('Arrivée introuvable');

  const arrival: number[] = Array.isArray(result.arrivalOrder) ? result.arrivalOrder : [];
  if (!arrival.length) throw new Error('Arrivée vide — impossible d\'envoyer');

  const race = result.pronostic?.race;
  const ds = format(result.date ?? new Date(), 'dd/MM/yyyy', { locale: fr });
  const type = race?.raceType ? `${race.raceType} ` : '';
  const message = `ARRIVEE ${type}${ds}:\n${arrival.join('-')}`;

  const activeSubscribers = await prisma.subscriber.findMany({ where: { status: 'ACTIVE' } });
  const results = await Promise.all(activeSubscribers.map((sub) => sendSmsToSubscriber(sub.id, message)));

  await (prisma.result as any).update({ where: { id: resultId }, data: { isSent: true } });

  const sent = results.filter((r) => r.success).length;
  logger.info(`Arrivée envoyée à ${sent}/${activeSubscribers.length} abonnés`);
  return { total: activeSubscribers.length, sent, failed: activeSubscribers.length - sent };
}

// ──────────────────────────────────────────────────────────────────────────────
// Envoi sortant : pronostic sportif
// ──────────────────────────────────────────────────────────────────────────────

export async function sendSportPronosticToActiveSubscribers(pronosticId: number, sport: string) {
  const pronostic = await prisma.sportPronostic.findUnique({
    where: { id: pronosticId },
    include: { event: true },
  });
  if (!pronostic) throw new Error('Pronostic sportif introuvable');

  const templateKey = sport === 'FOOTBALL' ? 'sms_default_foot' : 'sms_default_basket';
  const templateSetting = await prisma.setting.findUnique({ where: { key: templateKey } });
  const template = templateSetting?.value
    ?? (sport === 'FOOTBALL'
      ? 'Prono FOOT {date} - {home} vs {away} ({league}) : {market} | Confiance {confidence}%'
      : 'Prono BASKET {date} - {home} vs {away} ({league}) : {market} | Confiance {confidence}%');

  const ev = pronostic.event as any;
  const predictions = (pronostic.predictions as any[]) || [];
  const topPrediction = predictions[0];
  const marketLabel = topPrediction
    ? `${topPrediction.label} (${Math.round((topPrediction.model_prob ?? 0) * 100)}%)`
    : 'N/A';

  const message = template
    .replace('{date}', format(pronostic.date, 'dd/MM/yyyy', { locale: fr }))
    .replace('{home}', ev?.homeTeam ?? '')
    .replace('{away}', ev?.awayTeam ?? '')
    .replace('{league}', ev?.league ?? '')
    .replace('{market}', marketLabel)
    .replace('{confidence}', String(pronostic.confidence));

  const activeSubscribers = await prisma.subscriber.findMany({ where: { status: 'ACTIVE' } });
  const results = await Promise.all(activeSubscribers.map((sub) => sendSmsToSubscriber(sub.id, message)));
  await prisma.sportPronostic.update({ where: { id: pronosticId }, data: { isSent: true } });

  const sent = results.filter((r) => r.success).length;
  logger.info(`Pronostic ${sport} #${pronosticId} envoyé à ${sent}/${activeSubscribers.length} abonnés`);
  return { total: activeSubscribers.length, sent, failed: activeSubscribers.length - sent };
}

// ──────────────────────────────────────────────────────────────────────────────
// Alertes expiration
// ──────────────────────────────────────────────────────────────────────────────

export async function checkExpiringSubscriptions() {
  const in2days = new Date(Date.now() + 2 * 86400000);
  const tomorrow = new Date(Date.now() + 86400000);

  const expiring = await prisma.subscriber.findMany({
    where: { status: 'ACTIVE', endDate: { gte: tomorrow, lte: in2days } },
  });

  for (const sub of expiring) {
    const daysLeft = Math.ceil((sub.endDate.getTime() - Date.now()) / 86400000);
    const message = `Votre abonnement IYA PMU expire dans ${daysLeft} jour(s). Renouvelez des maintenant.`;
    await sendSmsToSubscriber(sub.id, message);
  }

  logger.info(`Alertes expiration envoyées à ${expiring.length} abonnés`);
}
