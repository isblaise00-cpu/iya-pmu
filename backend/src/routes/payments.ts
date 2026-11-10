/**
 * Webhook paiement ONatel — route PUBLIQUE (pas d'auth).
 *
 * ONatel envoie une notification HTTP POST à chaque paiement confirmé.
 * Ce handler :
 *  1. Valide les champs reçus
 *  2. Détecte les doublons (idempotence par transaction_id)
 *  3. Associe le montant à un plan actif (tolérance ±5 %)
 *  4. Crée ou renouvelle l'abonné
 *  5. Enregistre le paiement
 *  6. Envoie un SMS de confirmation
 *
 * URL à transmettre à ONatel :
 *   POST https://[votre-domaine]/api/payments/webhook/onatel
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { smsAdapter } from '../adapters/sms.adapter';
import { logger } from '../lib/logger';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { handleIncomingSms } from '../services/sms.service';

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise le numéro de téléphone reçu en format +226XXXXXXXX. */
function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, '');
  // Si déjà en international sans + (ex: 22671439050)
  if (digits.length >= 11) return '+' + digits;
  // Si local (ex: 71439050 → +22671439050)
  return '+226' + digits;
}

/** Trouve le plan dont le prix correspond au montant payé (tolérance ±5 %). */
function matchPlan(plans: any[], amount: number): any | null {
  return (
    plans.find((p) => Math.abs(p.price - amount) <= p.price * 0.05) ?? null
  );
}

/** Extrait un champ parmi plusieurs noms possibles (chaque opérateur a ses noms). */
function pick(body: any, ...keys: string[]): string {
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') {
      return String(body[k]).trim();
    }
  }
  return '';
}

// ── Webhook principal (POST + GET) ───────────────────────────────────────────
// ONatel peut envoyer en POST (body JSON) ou en GET (query params)

async function handleONatelPaymentWebhook(data: any, res: Response) {
  res.json({ status: 'ok' });

  try {
    const body = data;
    logger.info('[Webhook ONatel] Notification reçue:', JSON.stringify(body));

    // ── 1. Extraction des champs (noms multiples selon la config ONatel) ──────
    const transactionId = pick(body, 'transaction_id', 'transactionId', 'txn_id', 'ref', 'reference');
    const status        = pick(body, 'status', 'payment_status', 'state').toUpperCase();
    const rawPhone      = pick(body, 'msisdn', 'phone', 'numero', 'subscriber_msisdn', 'from');
    const rawAmount     = pick(body, 'amount', 'montant', 'price');
    const clientName    = pick(body, 'name', 'nom', 'subscriber_name') || '';

    // ── 2. Paiements non confirmés → on ignore silencieusement ───────────────
    if (status && status !== 'SUCCESS' && status !== 'SUCCESSFUL' && status !== 'COMPLETED') {
      logger.warn(`[Webhook ONatel] Paiement ignoré — statut: ${status}`);
      return;
    }

    if (!rawPhone || !rawAmount) {
      logger.warn('[Webhook ONatel] Champs manquants (phone ou amount):', body);
      return;
    }

    const amount = parseFloat(rawAmount);
    if (isNaN(amount) || amount <= 0) {
      logger.warn(`[Webhook ONatel] Montant invalide: ${rawAmount}`);
      return;
    }

    const phone = normalizePhone(rawPhone);

    // ── 3. Idempotence — évite de traiter deux fois la même transaction ───────
    if (transactionId) {
      const duplicate = await prisma.payment.findFirst({
        where: { note: { contains: `ONATEL:${transactionId}` } },
      });
      if (duplicate) {
        logger.info(`[Webhook ONatel] Transaction ${transactionId} déjà traitée — ignorée.`);
        return;
      }
    }

    // ── 4. Association au plan par montant ────────────────────────────────────
    const plans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { price: 'asc' } });
    const plan  = matchPlan(plans, amount);

    if (!plan) {
      logger.warn(
        `[Webhook ONatel] Aucun plan correspondant au montant ${amount} FCFA. ` +
        `Plans disponibles : ${plans.map((p) => `${p.name}=${p.price}`).join(', ')}`
      );
      // SMS d'erreur à l'abonné pour ne pas le laisser sans réponse
      await smsAdapter.send({
        to: phone,
        message: `IYA PMU: Paiement de ${amount} FCFA recu mais montant non reconnu. Contactez le support.`,
      });
      return;
    }

    // ── 5. Création ou renouvellement de l'abonné ─────────────────────────────
    const now      = new Date();
    const existing = await prisma.subscriber.findFirst({
      where: {
        OR: [
          { phone },
          { phone: rawPhone },
          { phone: rawPhone.replace(/^\+/, '') },
        ],
      },
    });

    let subscriber: any;
    let isNew = false;

    if (existing) {
      // Renouvellement : on prolonge à partir de la date de fin actuelle si encore active,
      // sinon on repart d'aujourd'hui
      const base    = existing.status === 'ACTIVE' && existing.endDate > now
        ? existing.endDate
        : now;
      const newEnd  = new Date(base.getTime() + plan.durationDays * 86400000);

      subscriber = await prisma.subscriber.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', planId: plan.id, endDate: newEnd },
      });
      logger.info(`[Webhook ONatel] Abonnement renouvelé — ${phone} → ${plan.name} jusqu'au ${newEnd.toISOString()}`);
    } else {
      // Nouvel abonné
      const endDate = new Date(now.getTime() + plan.durationDays * 86400000);
      subscriber = await prisma.subscriber.create({
        data: {
          phone,
          name: clientName || phone,
          planId: plan.id,
          status: 'ACTIVE',
          startDate: now,
          endDate,
        },
      });
      isNew = true;
      logger.info(`[Webhook ONatel] Nouvel abonné créé — ${phone} → ${plan.name}`);
    }

    // ── 6. Enregistrement du paiement ─────────────────────────────────────────
    await prisma.payment.create({
      data: {
        subscriberId: subscriber.id,
        amount,
        planId: plan.id,
        paymentDate: now,
        note: transactionId ? `ONATEL:${transactionId}` : `ONATEL:${now.toISOString()}`,
      },
    });

    // ── 7. SMS de confirmation ────────────────────────────────────────────────
    const expiry  = format(subscriber.endDate, 'dd/MM/yyyy', { locale: fr });
    const message = isNew
      ? [
          `Bienvenue sur IYA PMU!`,
          `Abonnement ${plan.name} actif jusqu'au ${expiry}.`,
          `Envoyez P pour le prono du jour.`,
          `Envoyez AIDE pour toutes les commandes.`,
        ].join('\n')
      : [
          `IYA PMU: Abonnement ${plan.name} renouvele.`,
          `Actif jusqu'au ${expiry}.`,
          `Envoyez P pour votre prono.`,
        ].join('\n');

    await smsAdapter.send({ to: phone, message });
    logger.info(`[Webhook ONatel] SMS de confirmation envoyé à ${phone}`);

  } catch (err: any) {
    logger.error('[Webhook ONatel] Erreur traitement:', err.message);
  }
}

// ── POST : paiement confirmé par ONatel ──────────────────────────────────────
router.post('/webhook/onatel', (req: Request, res: Response) =>
  handleONatelPaymentWebhook(req.body, res)
);

// ── GET : USSD *3375# ─────────────────────────────────────────────────────────
// Params : msisdn={{msisdn}}&userinput={{userinput}}&sessionid={{sessionId}}
//
// 1er appel (userinput vide) → retourne le menu USSD
// 2e appel (userinput = choix) → mappe vers commande SMS → envoie SMS au client

const USSD_MENU = [
  '== IYA PMU - MENU ==',
'1- Prono du jour',
'2- Couple',
'3- Combis 1-5',
'4- Top 4',
'5- Favoris',
'6- Eviter',
'7- Resultat',
'8- Solde',
'0- Aide',
].join('\n');

const USSD_MAP: Record<string, string> = {
  '1': 'P',
  '2': 'C',
  '3': 'CB1',
  '4': 'TOP',
  '5': 'F',
  '6': 'CE',
  '7': 'RESULTAT',
  '8': 'SOLDE',
  '0': 'AIDE',
};

router.get('/webhook/onatel', async (req: Request, res: Response) => {
  const phone     = String(req.query.msisdn    || '').trim();
  const userinput = String(req.query.userinput || '').trim();

  // 1er appel : afficher le menu
  if (!userinput) {
    return res.type('text/plain').send(USSD_MENU);
  }

  // 2e appel : traiter le choix
  const command = USSD_MAP[userinput] ?? userinput.toUpperCase();
  logger.info(`[USSD] *3375# — msisdn=${phone} choix=${userinput} → commande=${command}`);

  // Réponse texte brut visible sur l'écran USSD
  res.type('text/plain').send('Demande envoyee.\nVous recevrez un SMS\ndans quelques instants.');

  if (phone) {
    handleIncomingSms(phone, command).catch((err: Error) =>
      logger.error('[USSD] Erreur traitement:', err.message)
    );
  }
});

export default router;
