import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import axios from 'axios';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const results = await prisma.result.findMany({
      orderBy: { date: 'desc' },
      include: { pronostic: true },
    });
    res.json(results);
  } catch (err) {
    logger.error('GET /results error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/fetch', async (_req: Request, res: Response) => {
  try {
    const aiUrl = process.env.AI_ENGINE_URL || 'http://ai-engine:8000';
    const response = await axios.post(`${aiUrl}/fetch-results`);
    res.json({ message: 'Results fetch triggered', data: response.data });
  } catch (err: any) {
    logger.error('POST /results/fetch error:', err);
    res.status(500).json({ error: 'Failed to trigger results fetch', detail: err.message });
  }
});

export default router;
