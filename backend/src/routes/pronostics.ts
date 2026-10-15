import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendPronosticToActiveSubscribers } from '../services/sms.service';
import { logger } from '../lib/logger';
import { startPipeline, getJob } from '../services/pipeline.service';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const pronostics = await prisma.pronostic.findMany({
      orderBy: { date: 'desc' },
      include: { race: true, result: true },
    });
    res.json(pronostics);
  } catch (err) {
    logger.error('GET /pronostics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/today', async (_req: Request, res: Response) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86400000);
    const race = await prisma.race.findFirst({
      where: { date: { gte: today, lt: tomorrow } },
      include: { pronostic: { include: { result: true } } },
    });
    if (!race) return res.json({ race: null, pronostic: null });
    res.json({ race, pronostic: race.pronostic });
  } catch (err) {
    logger.error('GET /pronostics/today error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pronostic = await prisma.pronostic.findUnique({
      where: { id: Number(req.params.id) },
      include: { race: true },
    });
    if (!pronostic) return res.status(404).json({ error: 'Not found' });
    res.json(pronostic);
  } catch (err) {
    logger.error('GET /pronostics/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { proposals, commentary } = req.body;
    const updated = await prisma.pronostic.update({
      where: { id: Number(req.params.id) },
      data: { proposals, commentary, modifiedByAdmin: true },
    });
    res.json(updated);
  } catch (err) {
    logger.error('PUT /pronostics/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/scrape/start', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true' || req.body?.force === true;
    const jobId = startPipeline(force);
    res.json({ jobId });
  } catch (err: any) {
    logger.error('POST /pronostics/scrape/start error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/scrape/job/:jobId', async (req: Request, res: Response) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });
  res.json(job);
});

router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const result = await sendPronosticToActiveSubscribers(Number(req.params.id));
    res.json({ message: 'Pronostic envoyé', ...result });
  } catch (err: any) {
    logger.error('POST /pronostics/:id/send error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
