import { Router, Request, Response } from 'express';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { sendSportPronosticToActiveSubscribers } from '../services/sms.service';
import { smsAdapter } from '../adapters/sms.adapter';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { logger } from '../lib/logger';
import { startSportsPipeline, getSportsJob } from '../services/sports-pipeline.service';

function gamblerUrl(): string {
  return (process.env.GAMBLER_API_URL ?? '').trim();
}
function gamblerHeaders() {
  return { 'X-API-Key': process.env.GAMBLER_API_KEY ?? '' };
}

const router = Router();

const VALID_SPORTS = ['FOOTBALL', 'BASKETBALL'];

function validateSport(sport: string, res: Response): string | null {
  const s = sport.toUpperCase();
  if (!VALID_SPORTS.includes(s)) {
    res.status(400).json({ error: `Sport invalide : "${sport}". Valeurs acceptées : ${VALID_SPORTS.join(', ')}` });
    return null;
  }
  return s;
}

// ── GET /:sport/today ────────────────────────────────────────────────────────
router.get('/:sport/today', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const pronostics = await prisma.sportPronostic.findMany({
      where: { sport, date: { gte: today, lt: tomorrow } },
      include: { event: { include: { result: true } } },
      orderBy: { event: { kickoff: 'asc' } },
    });
    res.json(pronostics);
  } catch (err) {
    logger.error(`GET /sports/${req.params.sport}/today error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /:sport/scrape/start ────────────────────────────────────────────────
router.post('/:sport/scrape/start', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  try {
    const force = req.query.force === 'true' || req.body?.force === true;
    const jobId = startSportsPipeline(sport, force);
    res.json({ jobId });
  } catch (err: any) {
    logger.error(`POST /sports/${req.params.sport}/scrape/start error:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:sport/scrape/job/:jobId ────────────────────────────────────────────
router.get('/:sport/scrape/job/:jobId', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  const job = getSportsJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });
  res.json(job);
});

// ── GET /:sport/matches ──────────────────────────────────────────────────────
router.get('/:sport/matches', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  const { league_id, date } = req.query as { league_id?: string; date?: string };
  if (!league_id) return res.status(400).json({ error: 'Paramètre league_id requis.' });
  try {
    const url = gamblerUrl();
    if (!url) return res.status(503).json({ error: 'GAMBLER_API_URL non configurée.' });
    const resolvedDate = date || new Date().toISOString().slice(0, 10);

    let data: any;

    if (sport === 'BASKETBALL') {
      // Le Gambler API basket utilise POST /api/sports/generate
      const response = await axios.post(
        `${url}/api/sports/generate`,
        { sport: 'BASKETBALL', date: resolvedDate, leagues: [league_id] },
        { headers: { ...gamblerHeaders(), 'Content-Type': 'application/json' }, timeout: 15_000 },
      );
      data = response.data;
      // Normalise events → matches + external_id
      if (Array.isArray(data.events)) {
        const matches = data.events.map((e: any) => ({
          ...e,
          external_id: `bsk-${e.home_team}-${e.away_team}-${e.kickoff}`,
        }));
        return res.json({ ...data, matches, events: undefined });
      }
    } else {
      const response = await axios.get(
        `${url}/api/${sport.toLowerCase()}/matches`,
        { params: { league_id, date: resolvedDate }, headers: gamblerHeaders(), timeout: 15_000 },
      );
      data = response.data;
    }

    res.json(data);
  } catch (err: any) {
    logger.error(`GET /sports/${req.params.sport}/matches error:`, err.message);
    res.status(502).json({ error: 'Impossible de contacter le Gambler API.' });
  }
});

// ── GET /:sport/leagues ──────────────────────────────────────────────────────
router.get('/:sport/leagues', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  try {
    const url = gamblerUrl();
    if (!url) return res.status(503).json({ error: 'GAMBLER_API_URL non configurée.' });
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const { data } = await axios.get(
      `${url}/api/${sport.toLowerCase()}/leagues`,
      { params: { date }, headers: gamblerHeaders(), timeout: 15_000 },
    );
    res.json(data);
  } catch (err: any) {
    const detail = err.response?.data ?? err.message ?? String(err);
    logger.error(`GET /sports/${req.params.sport}/leagues error: url=${gamblerUrl()} detail=${JSON.stringify(detail)}`);
    res.status(502).json({ error: 'Impossible de contacter le Gambler API.', detail });
  }
});

// ── GET /:sport ──────────────────────────────────────────────────────────────
router.get('/:sport', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  try {
    const pronostics = await prisma.sportPronostic.findMany({
      where: { sport },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: { event: { include: { result: true } } },
    });
    res.json(pronostics);
  } catch (err) {
    logger.error(`GET /sports/${req.params.sport} error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /:sport/:id ──────────────────────────────────────────────────────────
router.get('/:sport/:id', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: `Paramètre id invalide : "${req.params.id}"` });
  try {
    const pronostic = await prisma.sportPronostic.findFirst({
      where: { id, sport },
      include: { event: { include: { result: true } } },
    });
    if (!pronostic) return res.status(404).json({ error: 'Not found' });
    res.json(pronostic);
  } catch (err) {
    logger.error(`GET /sports/${req.params.sport}/${req.params.id} error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /:sport/:id ──────────────────────────────────────────────────────────
router.put('/:sport/:id', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: `Paramètre id invalide : "${req.params.id}"` });
  try {
    const { predictions, commentary } = req.body;
    const updated = await prisma.sportPronostic.update({
      where: { id },
      data: { predictions, commentary, modifiedByAdmin: true },
    });
    res.json(updated);
  } catch (err) {
    logger.error(`PUT /sports/${req.params.sport}/${req.params.id} error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /:sport/:id/send ────────────────────────────────────────────────────
router.post('/:sport/:id/send', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: `Paramètre id invalide : "${req.params.id}"` });
  try {
    const result = await sendSportPronosticToActiveSubscribers(id, sport);
    res.json({ message: 'Pronostic envoyé', ...result });
  } catch (err: any) {
    logger.error(`POST /sports/${req.params.sport}/${req.params.id}/send error:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:sport/send-to-phones ──────────────────────────────────────────────
// Envoie des pronostics (données match directes) à une liste de numéros.
// Body: {
//   matches: { home, away, league, kickoff, market, confidence }[],
//   phones: string[]
// }
router.post('/:sport/send-to-phones', async (req: Request, res: Response) => {
  const sport = validateSport(req.params.sport, res);
  if (!sport) return;

  const { matches, phones } = req.body as {
    matches: { home: string; away: string; league: string; kickoff: string; market: string; confidence: number }[];
    phones: string[];
  };
  if (!Array.isArray(matches) || matches.length === 0)
    return res.status(400).json({ error: 'matches requis (tableau non vide)' });
  if (!Array.isArray(phones) || phones.length === 0)
    return res.status(400).json({ error: 'phones requis (tableau non vide)' });

  try {
    const sportLabel = sport === 'FOOTBALL' ? 'FOOT' : 'BASKET';
    const today = format(new Date(), 'dd/MM/yyyy', { locale: fr });

    let sent = 0;
    let failed = 0;

    for (const m of matches) {
      const message = `IYA PRONO ${sportLabel} ${today}\n• (${m.league}) : ${m.home} vs ${m.away} - ${m.market}`;
      for (const phone of phones) {
        const normalized = phone.startsWith('+') ? phone : '+' + phone;
        const result = await smsAdapter.send({ to: normalized, message });
        result.success ? sent++ : failed++;
      }
    }

    res.json({ sent, failed, total: matches.length * phones.length });
  } catch (err: any) {
    logger.error(`POST /sports/${req.params.sport}/send-to-phones error:`, err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
