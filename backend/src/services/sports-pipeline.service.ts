/**
 * sports-pipeline.service.ts
 *
 * Remplace l'ai-engine pour la génération des pronostics sportifs.
 * Appelle le Gambler API, persiste SportEvent + SportPronostic via Prisma.
 */
import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { JobStatus } from './pipeline.service';

export type { JobStatus };

const SPORT_JOBS = new Map<string, JobStatus>();

export function getSportsJob(jobId: string): JobStatus | null {
  return SPORT_JOBS.get(jobId) ?? null;
}

function gamblerUrl(): string {
  return (process.env.GAMBLER_API_URL ?? '').trim();
}

function gamblerHeaders() {
  return {
    'X-API-Key': process.env.GAMBLER_API_KEY ?? '',
    'Content-Type': 'application/json',
  };
}

const DEFAULT_LEAGUES: Record<string, string[]> = {
  FOOTBALL: ['39', '140', '135', '78', '61', '2'],
};

export function startSportsPipeline(sport: string, force = false): string {
  const s = sport.toUpperCase();
  const jobId = crypto.randomUUID();
  SPORT_JOBS.set(jobId, { status: 'pending', step: null, progress: 0, message: '', result: null, error: null });
  _run(jobId, s, force).catch((err) => logger.error(`[SportsPipeline:${s}] Erreur non capturée:`, err));
  return jobId;
}

function upd(jobId: string, patch: Partial<JobStatus>) {
  const job = SPORT_JOBS.get(jobId);
  if (job) Object.assign(job, patch);
}

async function _run(jobId: string, sport: string, force: boolean) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86_400_000);

    // Idempotence
    const existingCount = await prisma.sportPronostic.count({
      where: { sport, date: { gte: today, lt: tomorrow } },
    });

    if (existingCount > 0 && !force) {
      upd(jobId, {
        status: 'finished', progress: 100,
        message: `Pronostics ${sport} du jour déjà disponibles.`,
        result: { sport, total: existingCount, cached: true },
      });
      return;
    }

    // Suppression si force
    if (existingCount > 0 && force) {
      logger.info(`[SportsPipeline:${sport}] force=true — suppression des données existantes.`);
      await _deleteToday(sport, today, tomorrow);
    }

    upd(jobId, { status: 'running', step: 'generate', progress: 20, message: `Génération ${sport} via THERACING API...` });

    const url = gamblerUrl();
    if (!url) throw new Error('GAMBLER_API_URL non configurée.');

    // Ligues depuis les settings (fallback sur les défauts)
    const leagueSetting = await prisma.setting.findUnique({
      where: { key: 'football_leagues' },
    });
    const leagues = leagueSetting?.value
      ? leagueSetting.value.split(',').map((l) => l.trim()).filter(Boolean)
      : DEFAULT_LEAGUES[sport] ?? [];

    const { data } = await axios.post(
      `${url}/api/sports/generate`,
      { sport, date: today.toISOString().slice(0, 10), leagues },
      { headers: gamblerHeaders(), timeout: 300_000 },
    );

    const events: any[] = data.events ?? [];

    if (events.length === 0) {
      upd(jobId, {
        status: 'finished', progress: 100,
        message: `Aucun match ${sport} programmé aujourd'hui.`,
        result: { sport, total: 0, cached: false },
      });
      return;
    }

    upd(jobId, { step: 'persist', progress: 85, message: 'Sauvegarde en base...' });

    const savedIds = await _persistAll(sport, today, events);

    upd(jobId, {
      status: 'finished', progress: 100,
      message: `${savedIds.length} pronostic(s) ${sport} générés.`,
      result: { sport, total: savedIds.length, ids: savedIds, cached: false },
    });

  } catch (err: any) {
    const msg = err.response?.data?.detail || err.response?.data?.error || err.message || String(err);
    logger.error(`[SportsPipeline:${sport}] Erreur: ${msg}`);
    upd(jobId, { status: 'error', message: `Erreur : ${msg}`, error: msg });
  }
}

async function _persistAll(sport: string, today: Date, events: any[]): Promise<number[]> {
  const saved: number[] = [];

  for (const ed of events) {
    const pred = ed.prediction ?? {};

    // Probabilities stored as 0-1 ratios
    const probHome = (pred.prob_home ?? 0) / 100;
    const probDraw = (pred.prob_draw ?? 0) / 100;
    const probAway = (pred.prob_away ?? 0) / 100;
    const winner   = (pred.winner ?? '') as string;

    const modelProbs = {
      prob_home: probHome,
      prob_draw: probDraw,
      prob_away: probAway,
      xg_home:   pred.xg_home ?? 0,
      xg_away:   pred.xg_away ?? 0,
    };

    const predictions = [
      { market: '1X2',     label: 'Domicile',                    model_prob: probHome, recommended: winner === 'Domicile',  rationale: '' },
      { market: '1X2',     label: 'Nul',                         model_prob: probDraw, recommended: winner === 'Nul',       rationale: '' },
      { market: '1X2',     label: 'Extérieur',                   model_prob: probAway, recommended: winner === 'Exterieur', rationale: '' },
      ...(pred.rec_over_25 ? [{ market: 'Over 2.5', label: 'Plus de 2.5 buts',          model_prob: 0, recommended: true, rationale: '' }] : []),
      ...(pred.rec_btts    ? [{ market: 'BTTS',     label: 'Les deux équipes marquent', model_prob: 0, recommended: true, rationale: '' }] : []),
    ];

    const confidence = Math.round(Math.max(probHome, probDraw, probAway) * 100);

    // Clé unique dérivée des équipes (l'API ne fournit pas d'external_id)
    const externalId = `${ed.league}:${ed.home_team}:${ed.away_team}`;

    // Upsert SportEvent
    const sportEvent = await prisma.sportEvent.upsert({
      where: { sport_externalId: { sport, externalId } },
      create: {
        sport,
        date:       today,
        league:     ed.league    ?? '',
        homeTeam:   ed.home_team ?? '',
        awayTeam:   ed.away_team ?? '',
        kickoff:    ed.kickoff   ?? '00:00',
        externalId,
      },
      update: {
        league:   ed.league    ?? '',
        homeTeam: ed.home_team ?? '',
        awayTeam: ed.away_team ?? '',
        kickoff:  ed.kickoff   ?? '00:00',
      },
    });

    // Upsert SportPronostic
    const existing = await prisma.sportPronostic.findUnique({ where: { eventId: sportEvent.id } });

    let prono;
    if (existing) {
      prono = await prisma.sportPronostic.update({
        where: { id: existing.id },
        data: { modelProbs, predictions, valueBets: [], commentary: '', confidence },
      });
    } else {
      prono = await prisma.sportPronostic.create({
        data: {
          eventId:    sportEvent.id,
          sport,
          date:       today,
          modelProbs,
          predictions,
          valueBets:  [],
          commentary: '',
          confidence,
        },
      });
    }

    saved.push(prono.id);
  }

  return saved;
}

async function _deleteToday(sport: string, today: Date, tomorrow: Date) {
  const events = await prisma.sportEvent.findMany({
    where: { sport, date: { gte: today, lt: tomorrow } },
    include: { pronostic: true, result: true },
  });
  for (const ev of events) {
    if (ev.result)    await prisma.sportResult.delete({ where: { id: ev.result.id } });
    if (ev.pronostic) await prisma.sportPronostic.delete({ where: { id: ev.pronostic.id } });
    await prisma.sportEvent.delete({ where: { id: ev.id } });
  }
}
