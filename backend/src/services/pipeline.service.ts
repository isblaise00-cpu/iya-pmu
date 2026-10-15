/**
 * pipeline.service.ts
 *
 * Remplace l'ai-engine pour la génération du pronostic hippique LONAB.
 * Appelle le Gambler API, persiste Race + Pronostic via Prisma.
 */
import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

// ── Job tracking en mémoire ───────────────────────────────────────────────────

export interface JobStatus {
  status: 'pending' | 'running' | 'finished' | 'error';
  step: string | null;
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: string | null;
}

const JOBS = new Map<string, JobStatus>();

export function getJob(jobId: string): JobStatus | null {
  return JOBS.get(jobId) ?? null;
}

// ── Config Gambler API ────────────────────────────────────────────────────────

function gamblerUrl(): string {
  return (process.env.GAMBLER_API_URL ?? '').trim();
}

function gamblerHeaders() {
  return {
    'X-API-Key': process.env.GAMBLER_API_KEY ?? '',
    'Content-Type': 'application/json',
  };
}

// ── Point d'entrée public ─────────────────────────────────────────────────────

export function startPipeline(force = false): string {
  const jobId = crypto.randomUUID();
  JOBS.set(jobId, { status: 'pending', step: null, progress: 0, message: '', result: null, error: null });
  // Lance en arrière-plan sans bloquer
  _run(jobId, force).catch((err) => logger.error('[Pipeline] Erreur non capturée:', err));
  return jobId;
}

// ── Pipeline interne ──────────────────────────────────────────────────────────

function upd(jobId: string, patch: Partial<JobStatus>) {
  const job = JOBS.get(jobId);
  if (job) Object.assign(job, patch);
}

async function _run(jobId: string, force: boolean) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86_400_000);

    // Idempotence : pronostic du jour déjà disponible ?
    const existing = await prisma.race.findFirst({
      where: { date: { gte: today, lt: tomorrow } },
      include: { pronostic: true },
    });

    if (existing?.pronostic && !force) {
      upd(jobId, {
        status: 'finished', progress: 100,
        message: 'Pronostic du jour déjà disponible.',
        result: { raceId: existing.id, pronosticId: existing.pronostic.id, cached: true },
      });
      return;
    }

    // Vérification : résultat déjà enregistré → interdire la régénération
    if (existing?.pronostic) {
      const result = await prisma.result.findUnique({ where: { pronosticId: existing.pronostic.id } });
      if (result) {
        upd(jobId, { status: 'error', message: 'Un pronostic avec une arrivée enregistrée ne peut pas être régénéré.' });
        return;
      }
    }

    upd(jobId, { status: 'running', step: 'generate', progress: 20, message: 'Génération du pronostic via Gambler API...' });

    const url = gamblerUrl();
    if (!url) throw new Error('GAMBLER_API_URL non configurée.');

    const { data } = await axios.post(
      `${url}/api/generate`,
      { date: today.toISOString().slice(0, 10) },
      { headers: gamblerHeaders(), timeout: 300_000 },
    );

    upd(jobId, { step: 'persist', progress: 85, message: 'Sauvegarde en base...' });

    const { raceId, pronosticId } = await _persist(data, today);

    upd(jobId, {
      status: 'finished', progress: 100,
      message: 'Sélection et combinaisons générées.',
      result: { raceId, pronosticId, cached: false },
    });

  } catch (err: any) {
    logger.error('[Pipeline] Erreur:', err.message);
    upd(jobId, { status: 'error', message: `Erreur : ${err.message}`, error: err.message });
  }
}

// ── Persistance ───────────────────────────────────────────────────────────────

async function _persist(data: any, today: Date): Promise<{ raceId: number; pronosticId: number }> {
  const r = data.race ?? {};
  const meta = data._meta ?? {};

  // Upsert Race
  const existingRace = await prisma.race.findFirst({
    where: { date: { gte: today, lt: new Date(today.getTime() + 86_400_000) } },
  });

  const raceData = {
    raceType:  r.type     ?? null,
    raceName:  r.race_name ?? null,
    hippodrome: r.hippodrome ?? null,
    distance:  r.distance  ? Number(r.distance) : null,
    numHorses: r.num_concurrents ? Number(r.num_concurrents) : null,
    startTime: r.start_time ?? null,
    pdfUrl:    meta.pdf_url ?? r.pdf_url ?? null,
  };

  let race;
  if (existingRace) {
    race = await prisma.race.update({ where: { id: existingRace.id }, data: raceData });
  } else {
    race = await prisma.race.create({ data: { date: today, ...raceData } });
  }

  // Upsert Pronostic
  const existingProno = await prisma.pronostic.findUnique({ where: { raceId: race.id } });

  let pronostic;
  if (existingProno) {
    pronostic = await prisma.pronostic.update({
      where: { id: existingProno.id },
      data: {
        horses:          data.horses    ?? null,
        proposals:       data.proposals ?? null,
        commentary:      data.commentary ?? null,
        isSent:          false,
        modifiedByAdmin: false,
      },
    });
  } else {
    pronostic = await prisma.pronostic.create({
      data: {
        date:       today,
        raceId:     race.id,
        horses:     data.horses    ?? null,
        proposals:  data.proposals ?? null,
        commentary: data.commentary ?? null,
      },
    });
  }

  return { raceId: race.id, pronosticId: pronostic.id };
}
