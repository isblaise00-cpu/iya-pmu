import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { subDays, endOfDay, eachDayOfInterval } from 'date-fns';

const router = Router();

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalSubscribers, activeSubscribers, expiredSubscribers, monthRevenue, todayPronostic, monthlyRequestsAgg] =
      await Promise.all([
        prisma.subscriber.count(),
        prisma.subscriber.count({ where: { status: 'ACTIVE' } }),
        prisma.subscriber.count({ where: { status: 'EXPIRED' } }),
        prisma.payment.aggregate({
          where: { paymentDate: { gte: startOfMonth } },
          _sum: { amount: true },
        }),
        prisma.pronostic.findFirst({ orderBy: { date: 'desc' } }),
        (prisma as any).requestStat.aggregate({
          where: { date: { gte: startOfMonth } },
          _sum: { count: true },
        }),
      ]);

    res.json({
      totalSubscribers,
      activeSubscribers,
      expiredSubscribers,
      suspendedSubscribers: totalSubscribers - activeSubscribers - expiredSubscribers,
      monthRevenue: monthRevenue._sum.amount || 0,
      todayPronostic,
      monthlyRequests: monthlyRequestsAgg._sum.count || 0,
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

    // Requêtes par jour (30 derniers jours)
    const requestStats = await (prisma as any).requestStat.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      orderBy: { date: 'asc' },
    });
    const dailyRequests = subscriberDays.map((day) => {
      const dateStr = day.toISOString().slice(0, 10);
      const stat = requestStats.find((s: any) => s.date.toISOString().slice(0, 10) === dateStr);
      return { date: dateStr, count: stat?.count ?? 0 };
    });

    // Results vs pronostics for success rate + good pronos contacts
    const resultsWithPronostics = await prisma.result.findMany({
      where: { pronosticId: { not: null } },
      orderBy: { date: 'desc' },
      include: { pronostic: true },
    });

    const successRate = { total: 0, success: 0 };
    const goodPronos: {
      date: string; nums: number[]; type: string;
      matched: number; total: number;
      recipients: { name: string; phone: string }[];
    }[] = [];

    for (const r of resultsWithPronostics) {
      if (!r.pronostic) continue;
      const arr = Array.isArray(r.arrivalOrder) ? (r.arrivalOrder as number[]) : [];
      const proposals = Array.isArray(r.pronostic.proposals) ? (r.pronostic.proposals as any[]) : [];

      // Success rate — check if any proposal fully covers the official arrival
      // Use size from first valid proposal for the official slice
      const firstValid = proposals.find((p: any) => Array.isArray(p?.nums) && p.nums.length >= 3);
      if (firstValid) {
        const size = firstValid.nums.length;
        const official = arr.slice(0, size).map(Number);
        if (official.length === size && new Set(official).size === size && official.every((n: number) => n > 0)) {
          const covered = proposals.some((p: any) => Array.isArray(p?.nums) && p.nums.length === size &&
            new Set(p.nums).size === size && p.nums.every((n: number) => official.includes(n)));
          successRate.total += 1;
          if (covered) successRate.success += 1;
        }
      }

      // Good pronos : scan ALL proposals, keep only perfect matches (all nums in official arrival, any order)
      let bestProposal: { predicted: number[]; matched: number } | null = null;
      for (const p of proposals) {
        const predicted: number[] = Array.isArray(p?.nums) ? p.nums : [];
        const size = predicted.length;
        if (size < 3) continue;
        const official = arr.slice(0, size).map(Number);
        if (official.length !== size || new Set(official).size !== size ||
            !official.every((n: number) => Number.isInteger(n) && n > 0)) continue;
        const matched = predicted.filter((n: number) => official.includes(n)).length;
        // Only keep perfect match: all predicted nums found in official arrival
        if (matched < size) continue;
        if (!bestProposal || matched > bestProposal.matched) {
          bestProposal = { predicted, matched };
        }
      }
      if (!bestProposal) continue;

      const { predicted, matched } = bestProposal;
      const size = predicted.length;

      const dateStart = new Date(r.date as Date); dateStart.setHours(0, 0, 0, 0);
      const dateEnd   = new Date(r.date as Date); dateEnd.setHours(23, 59, 59, 999);

      // Fetch SMS logs that day (pronostic sends, not campaigns)
      const logs = await prisma.smsLog.findMany({
        where: { sentAt: { gte: dateStart, lte: dateEnd }, campaignId: null },
        include: { subscriber: { select: { name: true, phone: true } } },
      });

      // Keep only logs whose message contains ALL winning numbers (round-robin: each subscriber got one combo)
      const matchingLogs = logs.filter((l) =>
        predicted.every((n: number) => new RegExp(`\\b${n}\\b`).test(l.message))
      );

      // Deduplicate by subscriberId (or by message if subscriberId is null)
      const seen = new Set<string>();
      const recipients: { name: string; phone: string }[] = [];
      for (const l of matchingLogs) {
        const key = l.subscriberId ? `id:${l.subscriberId}` : `ph:${l.subscriber?.phone ?? l.message.slice(0, 20)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        recipients.push({ name: l.subscriber?.name ?? '', phone: l.subscriber?.phone ?? '' });
      }

      goodPronos.push({
        date: (r.date as Date).toISOString().slice(0, 10),
        nums: predicted,
        type: size === 3 ? 'Tiercé' : size === 4 ? 'Quarté' : 'Quinté',
        matched,
        total: size,
        recipients,
      });
    }

    res.json({
      subscriberGrowth,
      dailyRequests,
      successRate: {
        total: successRate.total,
        success: successRate.success,
        rate: successRate.total > 0 ? Math.round((successRate.success / successRate.total) * 100) : 0,
      },
      goodPronos,
    });
  } catch (err) {
    logger.error('GET /dashboard/charts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
