import { Router, Request, Response } from 'express';
import { handleIncomingSms } from '../services/sms.service';
import { logger } from '../lib/logger';

const router = Router();

// ── Menu USSD affiché au client lors de l'initiation ─────────────────────────
const USSD_MENU = [
  'IYA PMU - Choisissez:',
  '1. Prono du jour',
  '2. Numero fetiche',
  '3. Couple',
  '4. Top 4',
  '5. Favoris cotes',
  '6. Regret (2e combi)',
  '7. Combinaisons 1-5',
  '8. Resultat du jour',
  '9. Solde abonnement',
  '0. Aide / Commandes',
].join('\n');

// ── Mapping choix USSD → commande SMS ────────────────────────────────────────
const USSD_CHOICE_MAP: Record<string, string> = {
  '1': 'PRONO',
  '2': 'NUM',
  '3': 'COUPLE',
  '4': 'TOP',
  '5': 'FAVORIS',
  '6': 'REGRET',
  '7': 'CB',
  '8': 'RESULTAT',
  '9': 'SOLDE',
  '0': 'AIDE',
};

/**
 * POST /api/ussd/webhook
 *
 * URL à configurer chez ONatel pour le service USSD 3375#.
 *
 * Champs attendus (tolère plusieurs formats ONatel) :
 *   msisdn / from / phoneNumber  → numéro du client
 *   input / text / body / message → saisie du client ("" ou "1" ou "2" etc.)
 *   type / requestType           → "initiation" (première frappe) ou "response" (choix)
 *   sessionId                    → identifiant de session (optionnel, loggé)
 *
 * Réponse attendue par ONatel :
 *   { message: string, action: "continue" | "end" }
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const phone: string = (
      req.body.msisdn      ||
      req.body.from        ||
      req.body.phoneNumber ||
      req.body.sender      ||
      ''
    ).trim();

    const input: string = (
      req.body.input   ||
      req.body.text    ||
      req.body.body    ||
      req.body.message ||
      ''
    ).trim();

    const requestType: string = (
      req.body.type        ||
      req.body.requestType ||
      ''
    ).toLowerCase();

    const sessionId: string = req.body.sessionId || req.body.session_id || '';

    logger.info(`[USSD] session=${sessionId} phone=${phone} type=${requestType} input="${input}"`);

    if (!phone) {
      return res.json({ message: 'Numero manquant.', action: 'end' });
    }

    // ── Initiation : le client vient de composer 3375# ────────────────────────
    // ONatel envoie type="initiation" ou input vide
    const isInitiation = requestType === 'initiation' || input === '';
    if (isInitiation) {
      return res.json({ message: USSD_MENU, action: 'continue' });
    }

    // ── Réponse : le client a saisi un choix ──────────────────────────────────
    const command = USSD_CHOICE_MAP[input];
    if (!command) {
      return res.json({
        message: `Choix "${input}" non reconnu.\n${USSD_MENU}`,
        action: 'continue',
      });
    }

    // Traitement asynchrone : on répond immédiatement à ONatel pour clore la
    // session USSD, puis on envoie le SMS au client via handleIncomingSms.
    handleIncomingSms(phone, command).catch((err: Error) =>
      logger.error('[USSD] Erreur traitement:', err.message)
    );

    return res.json({
      message: 'Votre demande est en cours. Vous recevrez un SMS dans quelques secondes.',
      action: 'end',
    });

  } catch (err) {
    logger.error('[USSD] Erreur webhook:', err);
    return res.json({ message: 'Erreur temporaire. Reessayez.', action: 'end' });
  }
});

export default router;
