# PMU Platform - Plateforme Pronostics Hippiques

Plateforme complète de gestion de pronostics PMU avec dashboard admin, API backend, moteur IA et base de données PostgreSQL.

## Architecture

```
pmu-platform/
├── frontend/     → React + Vite + TailwindCSS   → http://localhost:3000
├── backend/      → Node.js + Express + Prisma   → http://localhost:4000
├── ai-engine/    → Python FastAPI + Claude API  → http://localhost:8000
└── database/     → Migrations Prisma + seeds
```

## Prérequis

- Node.js 18+
- Python 3.11+
- PostgreSQL 14+

## Configuration

```bash
cp .env.example .env
# Éditer .env avec votre clé ANTHROPIC_API_KEY et DATABASE_URL
```

## Démarrage

### 1. Backend

```bash
cd backend
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev
```

### 2. AI Engine

```bash
cd ai-engine
pip install -r requirements.txt
playwright install chromium
uvicorn main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

## Accès

| Service         | URL                        |
|----------------|----------------------------|
| Dashboard Admin | http://localhost:3000      |
| API Backend     | http://localhost:4000      |
| AI Engine       | http://localhost:8000      |
| API Docs        | http://localhost:8000/docs |

## Configuration SMS

Le provider SMS est abstrait derrière une interface. Pour brancher votre provider :

1. Modifier `SMS_PROVIDER` dans `.env` (`mock` | `orange` | `twilio` | `vonage`)
2. Renseigner `SMS_API_KEY` et `SMS_SENDER`
3. En mode `mock`, les SMS sont loggés en console uniquement

## Commandes SMS supportées

Les abonnés actifs peuvent envoyer ces commandes par SMS :

| Commande   | Réponse                          |
|-----------|----------------------------------|
| `PRONO`   | Pronostic du jour                |
| `RESULTAT`| Dernier résultat de course       |
| `SOLDE`   | Jours restants d'abonnement      |
| `AIDE`    | Liste des commandes disponibles  |

## Structure de la base de données

- **subscribers** - Abonnés avec statut et forfait
- **plans** - Forfaits disponibles
- **pronostics** - Pronostics générés par l'IA
- **results** - Résultats des courses
- **sms_campaigns** - Campagnes d'envoi SMS
- **sms_logs** - Historique des envois
- **settings** - Configuration système
- **payments** - Historique des paiements

## API Endpoints

Voir la documentation complète sur `http://localhost:8000/docs` (AI Engine) et `http://localhost:4000/api-docs` (Backend).
