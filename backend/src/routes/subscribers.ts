import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, planId, search } = req.query;
    const where: any = {};
    if (status) where.status = status;
    if (planId) where.planId = Number(planId);
    if (search) {
      const term = String(search).trim();
      const phoneDigits = term.replace(/\D/g, '');
      where.OR = [
        { name: { contains: term } },
        { phone: { contains: term } },
        ...(phoneDigits ? [{ phone: { contains: phoneDigits } }] : []),
      ];
    }
    const subscribers = await prisma.subscriber.findMany({
      where,
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(subscribers);
  } catch (err) {
    logger.error('GET /subscribers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { phone, name, planId, startDate, note } = req.body;
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(400).json({ error: 'Plan not found' });

    const start = startDate ? new Date(startDate) : new Date();
    const end = new Date(start.getTime() + plan.durationDays * 86400000);

    const subscriber = await prisma.subscriber.create({
      data: { phone, name, planId, startDate: start, endDate: end, status: 'ACTIVE' },
      include: { plan: true },
    });

    if (plan.price > 0) {
      await prisma.payment.create({
        data: { subscriberId: subscriber.id, amount: plan.price, planId, note: note || null, paymentDate: start },
      });
    }

    res.status(201).json(subscriber);
  } catch (err: any) {
    logger.error('POST /subscribers error:', err);
    if (err.code === 'P2002') return res.status(409).json({ error: 'Phone number already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, phone, status, planId, endDate } = req.body;
    const updated = await prisma.subscriber.update({
      where: { id: Number(req.params.id) },
      data: { name, phone, status, planId, endDate: endDate ? new Date(endDate) : undefined },
      include: { plan: true },
    });
    res.json(updated);
  } catch (err: any) {
    logger.error('PUT /subscribers/:id error:', err);
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const existing = await prisma.subscriber.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await prisma.$transaction([
      // 1. Désabonner (statut EXPIRED) avant la suppression — semantique claire
      prisma.subscriber.update({ where: { id }, data: { status: 'EXPIRED' } }),
      // 2. Préserver l'historique SMS en détachant la FK (subscriberId est nullable)
      prisma.smsLog.updateMany({ where: { subscriberId: id }, data: { subscriberId: null } }),
      // 3. Supprimer les paiements (FK NOT NULL → on doit nettoyer avant le subscriber)
      prisma.payment.deleteMany({ where: { subscriberId: id } }),
      // 4. Suppression définitive
      prisma.subscriber.delete({ where: { id } }),
    ]);
    res.json({ message: 'Désabonné et supprimé' });
  } catch (err: any) {
    logger.error('DELETE /subscribers/:id error:', err);
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/payments', async (req: Request, res: Response) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { subscriberId: Number(req.params.id) },
      include: { plan: true },
      orderBy: { paymentDate: 'desc' },
    });
    res.json(payments);
  } catch (err) {
    logger.error('GET /subscribers/:id/payments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
