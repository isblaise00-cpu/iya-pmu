import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const plans = await prisma.plan.findMany({ orderBy: { price: 'asc' } });
    res.json(plans);
  } catch (err) {
    logger.error('GET /plans error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, price, durationDays, description } = req.body;
    const plan = await prisma.plan.create({ data: { name, price, durationDays, description } });
    res.status(201).json(plan);
  } catch (err) {
    logger.error('POST /plans error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, price, durationDays, description, isActive } = req.body;
    const plan = await prisma.plan.update({
      where: { id: Number(req.params.id) },
      data: { name, price, durationDays, description, isActive },
    });
    res.json(plan);
  } catch (err: any) {
    logger.error('PUT /plans/:id error:', err);
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.plan.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Deleted' });
  } catch (err: any) {
    logger.error('DELETE /plans/:id error:', err);
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
