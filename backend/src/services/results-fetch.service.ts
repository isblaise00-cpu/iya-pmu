/**
 * results-fetch.service.ts
 *
 * Remplace l'ai-engine pour la récupération des résultats hippiques LONAB.
 * Appelle le Gambler API, persiste Result via Prisma.
 */
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

function gamblerUrl(): string {
  return (process.env.GAMBLER_API_URL ?? '').trim();
}

function gamblerHeaders() {
  return {
    'X-API-Key': process.env.GAMBLER_API_KEY ?? '',
    'Content-Type': 'application/json',
  };
}

export async function fetchAndSaveResults(): Promise<{
  resultId: number;
  arrivalOrder: number[];
  raceType: string | null;
  source: string | null;
}> {
  const url = gamblerUrl();
  if (!url) throw new Error('GAMBLER_API_URL non configurée.');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86_400_000);

  logger.info('[Results] Appel Gambler API pour les résultats du jour...');

  const { data } = await axios.post(
    `${url}/api/results/fetch`,
    { date: today.toISOString().slice(0, 10) },
    { headers: gamblerHeaders(), timeout: 120_000 },
  );

  // Trouver le pronostic du jour
  const race = await prisma.race.findFirst({
    where: { date: { gte: today, lt: tomorrow } },
    include: { pronostic: true },
  });

  const pronosticId = race?.pronostic?.id ?? null;

  // Upsert Result
  const existing = pronosticId
    ? await prisma.result.findUnique({ where: { pronosticId } })
    : null;

  let result;
  if (existing) {
    result = await prisma.result.update({
      where: { id: existing.id },
      data: { arrivalOrder: data.arrival_order, source: data.source ?? null },
    });
    logger.info(`[Results] Résultat mis à jour (id=${result.id})`);
  } else {
    result = await prisma.result.create({
      data: {
        arrivalOrder: data.arrival_order,
        source:       data.source ?? null,
        pronosticId,
      },
    });
    logger.info(`[Results] Résultat enregistré (id=${result.id}, pronosticId=${pronosticId})`);
  }

  return {
    resultId:     result.id,
    arrivalOrder: data.arrival_order,
    raceType:     data.race_type ?? null,
    source:       data.source ?? null,
  };
}
