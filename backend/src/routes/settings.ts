import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await prisma.setting.findMany();
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    res.json(map);
  } catch (err) {
    logger.error('GET /settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/', async (req: Request, res: Response) => {
  try {
    const entries = Object.entries(req.body as Record<string, string>);
    const updated = await Promise.all(
      entries.map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        })
      )
    );
    res.json(Object.fromEntries(updated.map((s) => [s.key, s.value])));
  } catch (err) {
    logger.error('PUT /settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
