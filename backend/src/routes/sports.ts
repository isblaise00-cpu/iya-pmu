import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendSportPronosticToActiveSubscribers } from '../services/sms.service';
import { logger } from '../lib/logger';
import { startSportsPipeline, getSportsJob } from '../services/sports-pipeline.service';

const router = Router();

const VALID_SPORTS = ['FOOTBALL'];

function validateSport(sport: string, res: Response): string | null {
  const s = sport.toUpperCase();
  if (!VALID_SPORTS.includes(s)) {
    res.status(400).json({ error: `Sport invalide : "${sport}". Valeurs acceptées : ${VALID_SPORTS.join(', ')}` });
    return null;
  }
  return s;
}

// ── GET /:sport/today ────────────────────────────────────────────────────────
router.get('/:sport/today', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const pronostics = await prisma.sportPronostic.findMany({
      where: { sport, date: { gte: today, lt: tomorrow } },
      include: { event: { include: { result: true } } },
      orderBy: { event: { kickoff: 'asc' } },
    });
    res.json(pronostics);
  } catch (err) {
    logger.error(`GET /sports/${req.params.sport}/today error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /:sport/scrape/start ────────────────────────────────────────────────
router.post('/:sport/scrape/start', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  try {
    const force = req.query.force === 'true' || req.body?.force === true;
    const jobId = startSportsPipeline(sport, force);
    res.json({ jobId });
  } catch (err: any) {
    logger.error(`POST /sports/${req.params.sport}/scrape/start error:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:sport/scrape/job/:jobId ────────────────────────────────────────────
router.get('/:sport/scrape/job/:jobId', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  const job = getSportsJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });
  res.json(job);
});

// ── GET /:sport ──────────────────────────────────────────────────────────────
router.get('/:sport', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  try {
    const pronostics = await prisma.sportPronostic.findMany({
      where: { sport },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: { event: { include: { result: true } } },
    });
    res.json(pronostics);
  } catch (err) {
    logger.error(`GET /sports/${req.params.sport} error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /:sport/:id ──────────────────────────────────────────────────────────
router.get('/:sport/:id', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  try {
    const pronostic = await prisma.sportPronostic.findFirst({
      where: { id: Number(req.params.id), sport },
      include: { event: { include: { result: true } } },
    });
    if (!pronostic) return res.status(404).json({ error: 'Not found' });
    res.json(pronostic);
  } catch (err) {
    logger.error(`GET /sports/${req.params.sport}/${req.params.id} error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /:sport/:id ──────────────────────────────────────────────────────────
router.put('/:sport/:id', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  try {
    const { predictions, commentary } = req.body;
    const updated = await prisma.sportPronostic.update({
      where: { id: Number(req.params.id) },
      data: { predictions, commentary, modifiedByAdmin: true },
    });
    res.json(updated);
  } catch (err) {
    logger.error(`PUT /sports/${req.params.sport}/${req.params.id} error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /:sport/:id/send ────────────────────────────────────────────────────
router.post('/:sport/:id/send', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  try {
    const result = await sendSportPronosticToActiveSubscribers(Number(req.params.id), sport);
    res.json({ message: 'Pronostic envoyé', ...result });
  } catch (err: any) {
    logger.error(`POST /sports/${req.params.sport}/${req.params.id}/send error:`, err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
