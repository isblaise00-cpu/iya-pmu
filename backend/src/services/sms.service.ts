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

/** Retourne les candidats classés depuis le prono principal (proposals[0].selection.candidates). */
function getCandidates(prono: any): any[] {
  const proposals = (prono.proposals as any[]) || [];
  const main = proposals.find((p: any) => p.id === 'prono_du_jour') || proposals[0];
  return (main?.selection?.candidates as any[]) || [];
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
  // Couple (2 meilleurs)
  'C': 'COUPLE', 'COUPLE': 'COUPLE',
  // Top 4 candidats
  'TOP': 'TOP', 'TOP4': 'TOP',
  // Favoris presse
  'F': 'FAVORIS', 'FAVORIS': 'FAVORIS', 'F8': 'FAVORIS',
  // Regret (combi #2)
  'R': 'REGRET', 'REGRET': 'REGRET',
  // Combinaisons — 4 pages couvrant les 20 pronostics
  // CB / CB1 → combis #2-#6   (proposals[1..5])
  // CB2      → combis #7-#11  (proposals[6..10])
  // CB3      → combis #12-#16 (proposals[11..15])
  // CB4      → combis #17-#20 (proposals[16..19])
  'CB': 'COMBI_1', 'CB1': 'COMBI_1', 'COMBI': 'COMBI_1', 'COMB': 'COMBI_1',
  'CB2': 'COMBI_2',
  'CB3': 'COMBI_3',
  'CB4': 'COMBI_4',
  // Classement complet des 7 candidats avec scores
  'SCORE': 'SCORE', 'SCORES': 'SCORE',
  // Chevaux à éviter
  'CE': 'EVITER', 'EVITER': 'EVITER',
  // Résultats
  'RESULTAT': 'RESULTAT', 'RESULTATS': 'RESULTAT',
  // Solde
  'SOLDE': 'SOLDE',
  // Aide
  'AIDE': 'AIDE', 'HELP': 'AIDE', 'X': 'AIDE',
};

async function resolveCommand(command: string, subscriber: any): Promise<string> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ds = format(today, 'dd/MM', { locale: fr });

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

    // ── Numéro fétiche ────────────────────────────────────────────────────────
    case 'NUM': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const candidates = getCandidates(prono);
      if (!candidates.length) return 'Numero fetiche non disponible.';
      const best = candidates[0];
      return `${header('NUM FETICHE', raceType(prono), ds)}\nNo.${best.num} ${best.nom}`;
    }

    // ── Couple (2 meilleurs candidats) ────────────────────────────────────────
    case 'COUPLE': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const candidates = getCandidates(prono);
      if (candidates.length < 2) return 'Couple non disponible.';
      const [a, b] = candidates;
      return `${header('COUPLE', raceType(prono), ds)}\nNo.${a.num} ${a.nom.split(' ')[0]} + No.${b.num} ${b.nom.split(' ')[0]}`;
    }

    // ── Top 4 candidats par score global ─────────────────────────────────────
    case 'TOP': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const candidates = getCandidates(prono);
      const top4 = candidates.slice(0, 4);
      if (!top4.length) return 'Classement non disponible.';
      const lines = top4.map((h: any, i: number) => `${i + 1}.No${h.num} ${h.nom.split(' ')[0]}`);
      return `${header('TOP4', raceType(prono), ds)}\n${lines.join('\n')}`;
    }

    // ── Favoris presse ────────────────────────────────────────────────────────
    case 'FAVORIS': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const sorted = [...getCandidates(prono)].sort((a: any, b: any) => b.press_score - a.press_score);
      const top4 = sorted.slice(0, 4);
      if (!top4.length) return 'Favoris non disponibles.';
      const lines = top4.map((h: any, i: number) => `${i + 1}.No${h.num} ${h.nom.split(' ')[0]}`);
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

    // ── Combinaisons — 4 pages couvrant les 20 pronostics ────────────────────
    case 'COMBI_1':
    case 'COMBI_2':
    case 'COMBI_3':
    case 'COMBI_4': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const proposals = (prono.proposals as any[]) || [];
      const page     = parseInt(command.split('_')[1], 10); // 1, 2, 3 ou 4
      const startIdx = 1 + (page - 1) * 5;                 // 1, 6, 11, 16
      const slice    = proposals.slice(startIdx, startIdx + 5);
      if (!slice.length) return `Aucune combinaison dans cette plage.`;
      const from  = startIdx + 1;
      const to    = startIdx + slice.length;
      const lines = slice.map((p: any, i: number) =>
        `${startIdx + i + 1}: ${(p.nums as number[]).join('-')}`
      );
      return `${header('COMBIS', raceType(prono), ds)} (${from}-${to}):\n${lines.join('\n')}`;
    }

    // ── Classement complet des 7 candidats avec scores ───────────────────────
    case 'SCORE': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const candidates = getCandidates(prono);
      if (!candidates.length) return 'Classement non disponible.';
      const lines = candidates.map((h: any, i: number) =>
        `${i + 1}.No${h.num} ${h.nom.split(' ')[0].substring(0, 8)} ${h.score}`
      );
      return `${header('SCORES', raceType(prono), ds)}\n${lines.join('\n')}`;
    }

    // ── Chevaux à éviter (non sélectionnés parmi les partants) ───────────────
    case 'EVITER': {
      const prono = await getTodayPronostic();
      if (!prono) return `Aucun prono disponible le ${ds}.`;
      const proposals = (prono.proposals as any[]) || [];
      const main = proposals.find((p: any) => p.id === 'prono_du_jour') || proposals[0];
      const selectedNums = new Set(
        ((main?.selection?.candidates ?? []) as any[]).map((h: any) => h.num)
      );
      const allHorses = (prono.horses as any[]) || [];
      const unselected = allHorses.filter((h: any) => !h.non_partant && !selectedNums.has(h.num));
      if (!unselected.length) return `Tous les partants sont dans la selection le ${ds}.`;
      const list = unselected.slice(0, 4)
        .map((h: any) => `No.${h.num} ${h.nom.split(' ')[0]}`).join(', ');
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
      const daysLeft = Math.ceil((subscriber.endDate.getTime() - Date.now()) / 86400000);
      return `Abonnement: ${daysLeft}j restants. Exp: ${format(subscriber.endDate, 'dd/MM/yy', { locale: fr })}`;
    }

    // ── Aide ──────────────────────────────────────────────────────────────────
    case 'AIDE':
      return [
        'IYA PMU - COMMANDES:',
        'P=Prono#1  R=Regret#2',
        'CB1=Combis 2-6',
        'CB2=Combis 7-11',
        'CB3=Combis 12-16',
        'CB4=Combis 17-20',
        'SCORE=Classement 7 chvx',
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

  if (!subscriber) {
    const setting = await prisma.setting.findUnique({ where: { key: 'sms_unknown' } });
    responseMessage = setting?.value ?? "Vous n'etes pas abonne. Contactez-nous.";
  } else if (subscriber.status === 'EXPIRED') {
    const setting = await prisma.setting.findUnique({ where: { key: 'sms_expired' } });
    responseMessage = setting?.value ?? 'Votre abonnement est expire. Renouvelez pour continuer.';
  } else if (subscriber.status === 'SUSPENDED') {
    responseMessage = 'Votre abonnement est suspendu. Contactez le support.';
  } else {
    try {
      responseMessage = await resolveCommand(command, subscriber);
    } catch (err: any) {
      logger.error(`[SMS] Erreur résolution commande "${command}":`, err.message);
      responseMessage = 'Erreur temporaire. Reessayez dans quelques instants.';
    }
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

  const proposals = (pronostic.proposals as any[]) || [];
  const pronoDuJour = proposals.find((p: any) => p.id === 'prono_du_jour') || proposals[0];
  const nums = (pronoDuJour?.nums as number[] || []).join(' - ');
  const confidence = pronoDuJour?.confidence ?? 0;
  const hippodrome = (pronostic.race as any)?.hippodrome ?? '';

  const message = renderHippiqueSms(templateSetting?.value, {
    date: format(pronostic.date, 'dd/MM/yyyy', { locale: fr }),
    hippodrome, nums, confidence, score: pronoDuJour?.score,
  });

  const activeSubscribers = await prisma.subscriber.findMany({ where: { status: 'ACTIVE' } });
  const results = await Promise.all(activeSubscribers.map((sub) => sendSmsToSubscriber(sub.id, message)));
  await prisma.pronostic.update({ where: { id: pronosticId }, data: { isSent: true } });

  const sent = results.filter((r) => r.success).length;
  logger.info(`Pronostic envoyé à ${sent}/${activeSubscribers.length} abonnés`);
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
