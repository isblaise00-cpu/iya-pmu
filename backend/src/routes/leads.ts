import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// GET /api/leads — liste paginée avec filtres date + recherche téléphone
router.get('/', async (req: Request, res: Response) => {
  try {
    const page     = Math.max(1, parseInt(String(req.query.page  || '1'), 10));
    const limit    = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
    const search   = String(req.query.search  || '').trim();
    const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : undefined;
    const dateTo   = req.query.dateTo   ? new Date(String(req.query.dateTo))   : undefined;

    if (dateTo) dateTo.setHours(23, 59, 59, 999);

    const where: any = {};
    if (search)   where.phone = { contains: search };
    if (dateFrom || dateTo) {
      where.firstSeenAt = {};
      if (dateFrom) where.firstSeenAt.gte = dateFrom;
      if (dateTo)   where.firstSeenAt.lte = dateTo;
    }

    const [total, leads] = await Promise.all([
      (prisma as any).lead.count({ where }),
      (prisma as any).lead.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.json({ leads, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/leads/:id — suppression manuelle
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });
    await (prisma as any).lead.delete({ where: { id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
