import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { fetchAndSaveResults } from '../services/results-fetch.service';
import { sendResultToActiveSubscribers } from '../services/sms.service';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const results = await prisma.result.findMany({
      orderBy: { date: 'desc' },
      include: { pronostic: { include: { race: true } } },
    });
    res.json(results);
  } catch (err) {
    logger.error('GET /results error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/fetch', async (_req: Request, res: Response) => {
  try {
    const result = await fetchAndSaveResults();
    res.json(result);
  } catch (err: any) {
    const gamblerDetail = err.response?.data?.detail;
    if (err.response?.status === 404 || err.response?.status === 503) {
      return res.status(404).json({ error: gamblerDetail ?? err.message });
    }
    logger.error('POST /results/fetch error:', err);
    res.status(500).json({ error: gamblerDetail ?? 'Impossible de récupérer les résultats', detail: err.message });
  }
});

router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const result = await sendResultToActiveSubscribers(Number(req.params.id));
    res.json({ message: 'Arrivée envoyée', ...result });
  } catch (err: any) {
    logger.error('POST /results/:id/send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
