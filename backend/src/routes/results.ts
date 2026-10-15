import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { fetchAndSaveResults } from '../services/results-fetch.service';

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
    if (err.response?.status === 503 || err.message?.includes('introuvable') || err.message?.includes('Aucun')) {
      return res.status(404).json({ error: err.message });
    }
    logger.error('POST /results/fetch error:', err);
    res.status(500).json({ error: 'Impossible de récupérer les résultats', detail: err.message });
  }
});

export default router;
