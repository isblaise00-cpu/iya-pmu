import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { smsAdapter } from '../adapters/sms.adapter';
import { handleIncomingSms } from '../services/sms.service';
import { logger } from '../lib/logger';

const router = Router();

router.get('/campaigns', async (_req: Request, res: Response) => {
  try {
    const campaigns = await prisma.smsCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { logs: true } } },
    });
    res.json(campaigns);
  } catch (err) {
    logger.error('GET /sms/campaigns error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/campaigns', async (req: Request, res: Response) => {
  try {
    const { name, message, target } = req.body;
    const campaign = await prisma.smsCampaign.create({
      data: { name, message, target: target || 'all', status: 'DRAFT' },
    });
    res.status(201).json(campaign);
  } catch (err) {
    logger.error('POST /sms/campaigns error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/campaigns/:id/send', async (req: Request, res: Response) => {
  try {
    const campaign = await prisma.smsCampaign.findUnique({ where: { id: Number(req.params.id) } });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const where: any = {};
    if (campaign.target === 'active') where.status = 'ACTIVE';

    const subscribers = await prisma.subscriber.findMany({ where });

    const results = await Promise.all(
      subscribers.map(async (sub) => {
        const result = await smsAdapter.send({ to: sub.phone, message: campaign.message });
        await prisma.smsLog.create({
          data: {
            subscriberId: sub.id,
            message: campaign.message,
            status: result.success ? 'SENT' : 'FAILED',
            campaignId: campaign.id,
            errorMessage: result.error ?? null,
          },
        });
        return result;
      })
    );

    const sent = results.filter((r) => r.success).length;
    await prisma.smsCampaign.update({
      where: { id: campaign.id },
      data: { status: 'SENT', sentAt: new Date() },
    });

    res.json({ message: 'Campaign sent', total: subscribers.length, sent, failed: subscribers.length - sent });
  } catch (err) {
    logger.error('POST /sms/campaigns/:id/send error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const { campaignId, subscriberId } = req.query;
    const where: any = {};
    if (campaignId) where.campaignId = Number(campaignId);
    if (subscriberId) where.subscriberId = Number(subscriberId);

    const logs = await prisma.smsLog.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      include: { subscriber: { select: { name: true, phone: true } }, campaign: { select: { name: true } } },
      take: 200,
    });
    res.json(logs);
  } catch (err) {
    logger.error('GET /sms/logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Modèles SMS ───────────────────────────────────────────────────────────────

router.get('/templates', async (_req: Request, res: Response) => {
  try {
    const templates = await prisma.smsTemplate.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(templates);
  } catch (err) {
    logger.error('GET /sms/templates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/templates', async (req: Request, res: Response) => {
  try {
    const { name, category = 'general', message } = req.body;
    if (!name || !message) return res.status(400).json({ error: 'name et message requis' });
    const template = await prisma.smsTemplate.create({ data: { name, category, message } });
    res.status(201).json(template);
  } catch (err) {
    logger.error('POST /sms/templates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/templates/:id', async (req: Request, res: Response) => {
  try {
    const { name, category, message } = req.body;
    const template = await prisma.smsTemplate.update({
      where: { id: Number(req.params.id) },
      data: { name, category, message },
    });
    res.json(template);
  } catch (err) {
    logger.error('PUT /sms/templates/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    await prisma.smsTemplate.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    logger.error('DELETE /sms/templates/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logs/:id/resend', async (req: Request, res: Response) => {
  try {
    const log = await prisma.smsLog.findUnique({
      where: { id: Number(req.params.id) },
      include: { subscriber: { select: { phone: true } } },
    });
    if (!log) return res.status(404).json({ error: 'Log introuvable' });
    if (!log.subscriber?.phone) return res.status(400).json({ error: 'Abonné ou numéro introuvable' });

    const result = await smsAdapter.send({ to: log.subscriber.phone, message: log.message });

    await prisma.smsLog.update({
      where: { id: log.id },
      data: {
        status: result.success ? 'SENT' : 'FAILED',
        errorMessage: result.error ?? null,
        sentAt: new Date(),
      },
    });

    res.json({ success: result.success, error: result.error ?? null });
  } catch (err: any) {
    logger.error('POST /sms/logs/:id/resend error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/receive', async (req: Request, res: Response) => {
  try {
    const { from, body } = req.body;
    if (!from || !body) return res.status(400).json({ error: 'Missing from or body' });

    const result = await handleIncomingSms(from, body);
    res.json(result);
  } catch (err) {
    logger.error('POST /sms/receive error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
