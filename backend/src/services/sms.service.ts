import { prisma } from '../lib/prisma';
import { smsAdapter } from '../adapters/sms.adapter';
import { logger } from '../lib/logger';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

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
  const template = templateSetting?.value ?? 'Prono PMUB {date} - {hippodrome} : {nums} (Confiance : {confidence}%)';

  const proposals = (pronostic.proposals as any[]) || [];
  const pronoDuJour = proposals.find((p: any) => p.id === 'prono_du_jour') || proposals[0];
  const nums = (pronoDuJour?.nums as number[] || []).join(' - ');
  const confidence = pronoDuJour?.confidence ?? 0;
  const hippodrome = (pronostic.race as any)?.hippodrome ?? '';

  const message = template
    .replace('{date}', format(pronostic.date, 'dd/MM/yyyy', { locale: fr }))
    .replace('{hippodrome}', hippodrome)
    .replace('{nums}', nums)
    .replace('{confidence}', String(confidence));

  const activeSubscribers = await prisma.subscriber.findMany({ where: { status: 'ACTIVE' } });
  const results = await Promise.all(activeSubscribers.map((sub) => sendSmsToSubscriber(sub.id, message)));
  await prisma.pronostic.update({ where: { id: pronosticId }, data: { isSent: true } });

  const sent = results.filter((r) => r.success).length;
  logger.info(`Pronostic envoyé à ${sent}/${activeSubscribers.length} abonnés`);
  return { total: activeSubscribers.length, sent, failed: activeSubscribers.length - sent };
}

export async function handleIncomingSms(phone: string, body: string) {
  const command = body.trim().toUpperCase();
  const subscriber = await prisma.subscriber.findUnique({
    where: { phone },
    include: { plan: true },
  });

  let responseMessage: string;

  if (!subscriber) {
    const setting = await prisma.setting.findUnique({ where: { key: 'sms_unknown' } });
    responseMessage = setting?.value ?? "Vous n'êtes pas abonné. Contactez-nous.";
  } else if (subscriber.status === 'EXPIRED') {
    const setting = await prisma.setting.findUnique({ where: { key: 'sms_expired' } });
    responseMessage = setting?.value ?? 'Votre abonnement est expiré. Renouvelez pour continuer.';
  } else if (subscriber.status === 'SUSPENDED') {
    responseMessage = 'Votre abonnement est suspendu. Contactez le support.';
  } else {
    switch (command) {
      case 'PRONO': {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const prono = await prisma.pronostic.findFirst({
          where: { date: { gte: today } },
          orderBy: { date: 'desc' },
          include: { race: true },
        });
        if (!prono) {
          responseMessage = "Aucun pronostic disponible aujourd'hui. Réessayez plus tard.";
        } else {
          const proposals = (prono.proposals as any[]) || [];
          const pronoDuJour = proposals.find((p: any) => p.id === 'prono_du_jour') || proposals[0];
          const nums = (pronoDuJour?.nums as number[] || []).join(' - ');
          const confidence = pronoDuJour?.confidence ?? 0;
          const hippodrome = (prono.race as any)?.hippodrome ?? '';
          responseMessage = `🏇 Prono PMUB ${hippodrome}\n🎯 Sélection : ${nums}\n✅ Confiance : ${confidence}%`;
        }
        break;
      }
      case 'RESULTAT': {
        const result = await prisma.result.findFirst({ orderBy: { date: 'desc' } });
        if (!result) {
          responseMessage = 'Aucun résultat disponible pour le moment.';
        } else {
          const arr = Array.isArray(result.arrivalOrder) ? (result.arrivalOrder as string[]).join(' - ') : '';
          responseMessage = `📊 Dernier résultat (${format(result.date, 'dd/MM', { locale: fr })}): ${arr}`;
        }
        break;
      }
      case 'SOLDE': {
        const daysLeft = Math.ceil((subscriber.endDate.getTime() - Date.now()) / 86400000);
        responseMessage = `📅 Votre abonnement expire dans ${daysLeft} jour(s) (${format(subscriber.endDate, 'dd/MM/yyyy', { locale: fr })}).`;
        break;
      }
      case 'AIDE':
        responseMessage = '📋 Commandes disponibles :\nPRONO - Pronostic du jour\nRESULTAT - Dernier résultat\nSOLDE - Jours restants\nAIDE - Cette aide';
        break;
      default:
        responseMessage = "Commande non reconnue. Envoyez AIDE pour la liste des commandes.";
    }
  }

  await smsAdapter.send({ to: phone, message: responseMessage });
  await prisma.smsLog.create({
    data: {
      subscriberId: subscriber?.id ?? null,
      message: responseMessage,
      status: 'SENT',
    },
  });

  return { handled: true, response: responseMessage };
}

export async function checkExpiringSubscriptions() {
  const in2days = new Date(Date.now() + 2 * 86400000);
  const tomorrow = new Date(Date.now() + 86400000);

  const expiring = await prisma.subscriber.findMany({
    where: { status: 'ACTIVE', endDate: { gte: tomorrow, lte: in2days } },
  });

  for (const sub of expiring) {
    const daysLeft = Math.ceil((sub.endDate.getTime() - Date.now()) / 86400000);
    const message = `⚠️ Votre abonnement PMU-PRONO expire dans ${daysLeft} jour(s). Renouvelez dès maintenant.`;
    await sendSmsToSubscriber(sub.id, message);
  }

  logger.info(`Alertes expiration envoyées à ${expiring.length} abonnés`);
}
