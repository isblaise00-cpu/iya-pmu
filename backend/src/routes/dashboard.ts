import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { subDays, endOfDay, eachDayOfInterval } from 'date-fns';

const router = Router();

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalSubscribers, activeSubscribers, expiredSubscribers, monthRevenue, todayPronostic] =
      await Promise.all([
        prisma.subscriber.count(),
        prisma.subscriber.count({ where: { status: 'ACTIVE' } }),
        prisma.subscriber.count({ where: { status: 'EXPIRED' } }),
        prisma.payment.aggregate({
          where: { paymentDate: { gte: startOfMonth } },
          _sum: { amount: true },
        }),
        prisma.pronostic.findFirst({ orderBy: { date: 'desc' } }),
      ]);

    res.json({
      totalSubscribers,
      activeSubscribers,
      expiredSubscribers,
      suspendedSubscribers: totalSubscribers - activeSubscribers - expiredSubscribers,
      monthRevenue: monthRevenue._sum.amount || 0,
      todayPronostic,
    });
  } catch (err) {
    logger.error('GET /dashboard/stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/charts', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = subDays(now, 30);

    // Subscribers growth over 30 days
    const subscriberDays = eachDayOfInterval({ start: thirtyDaysAgo, end: now });
    const subscriberGrowth = await Promise.all(
      subscriberDays.map(async (day) => {
        const count = await prisma.subscriber.count({
          where: { createdAt: { lte: endOfDay(day) } },
        });
        return { date: day.toISOString().slice(0, 10), count };
      })
    );

    // Pronostics confidence scores (last 30)
    const recentPronostics = await prisma.pronostic.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      orderBy: { date: 'asc' },
      select: { date: true, confidenceScore: true, isSent: true },
    });

    // Results vs pronostics for success rate
    const resultsWithPronostics = await prisma.result.findMany({
      where: { date: { gte: thirtyDaysAgo }, pronosticId: { not: null } },
      include: { pronostic: true },
    });

    const successRate = resultsWithPronostics.reduce(
      (acc, r) => {
        if (!r.pronostic) return acc;
        const arr = Array.isArray(r.arrivalOrder) ? (r.arrivalOrder as string[]) : [];
        const tierce = Array.isArray(r.pronostic.tierce) ? (r.pronostic.tierce as string[]) : [];
        const tierceMatch = tierce.filter((h) => arr.slice(0, 3).includes(h)).length;
        acc.total += 1;
        if (tierceMatch >= 2) acc.success += 1;
        return acc;
      },
      { total: 0, success: 0 }
    );

    res.json({
      subscriberGrowth,
      pronosticsConfidence: recentPronostics.map((p) => ({
        date: p.date.toISOString().slice(0, 10),
        score: p.confidenceScore,
        sent: p.isSent,
      })),
      successRate: {
        total: successRate.total,
        success: successRate.success,
        rate: successRate.total > 0 ? Math.round((successRate.success / successRate.total) * 100) : 0,
      },
    });
  } catch (err) {
    logger.error('GET /dashboard/charts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
