import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendPronosticToActiveSubscribers } from '../services/sms.service';
import { logger } from '../lib/logger';
import { env } from '../lib/env';
import axios from 'axios';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const pronostics = await prisma.pronostic.findMany({
      orderBy: { date: 'desc' },
      include: { result: true, race: { include: { horses: { orderBy: { number: 'asc' } } } } },
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
      include: { horses: { orderBy: { number: 'asc' } }, pronostic: true },
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
      include: { result: true, race: { include: { horses: { orderBy: { number: 'asc' } } } } },
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
    const { baseHorse, tierce, quarte, quinte, outsider, confidenceScore, commentary } = req.body;
    const updated = await prisma.pronostic.update({
      where: { id: Number(req.params.id) },
      data: { baseHorse, tierce, quarte, quinte, outsider, confidenceScore, commentary, modifiedByAdmin: true },
    });
    res.json(updated);
  } catch (err) {
    logger.error('PUT /pronostics/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/trigger', async (_req: Request, res: Response) => {
  try {
    const response = await axios.post(`${env.AI_ENGINE_URL}/scrape`);
    res.json({ message: 'Scraping triggered', data: response.data });
  } catch (err: any) {
    logger.error('POST /pronostics/trigger error:', err);
    res.status(500).json({ error: 'Failed to trigger scraping', detail: err.message });
  }
});

// New LONAB pipeline (PDF → parse → enrich → AI). Returns a job ID immediately;
// the frontend polls /pronostics/scrape/job/:jobId for progress.
router.post('/scrape/start', async (_req: Request, res: Response) => {
  try {
    const response = await axios.post(`${env.AI_ENGINE_URL}/pipeline/start`, {}, { timeout: 10000 });
    res.json(response.data);
  } catch (err: any) {
    logger.error('POST /pronostics/scrape/start error:', err);
    res.status(502).json({ error: "Impossible de joindre le moteur IA", detail: err.message });
  }
});

router.get('/scrape/job/:jobId', async (req: Request, res: Response) => {
  try {
    const response = await axios.get(`${env.AI_ENGINE_URL}/pipeline/job/${req.params.jobId}`, { timeout: 5000 });
    res.json(response.data);
  } catch (err: any) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: "Job introuvable" });
    }
    logger.error('GET /pronostics/scrape/job/:jobId error:', err);
    res.status(502).json({ error: "Impossible de joindre le moteur IA", detail: err.message });
  }
});

router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const result = await sendPronosticToActiveSubscribers(Number(req.params.id));
    res.json({ message: 'Pronostic sent', ...result });
  } catch (err: any) {
    logger.error('POST /pronostics/:id/send error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
