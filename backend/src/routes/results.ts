import { Router, Request, Response } from 'express';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { env } from '../lib/env';

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
    const response = await axios.post(
      `${env.AI_ENGINE_URL}/results/fetch`,
      {},
      { timeout: 120_000 },
    );
    res.json(response.data);
  } catch (err: any) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: err.response.data?.detail || 'Résultats non disponibles' });
    }
    logger.error('POST /results/fetch error:', err);
    res.status(502).json({ error: 'Impossible de récupérer les résultats', detail: err.message });
  }
});

export default router;
