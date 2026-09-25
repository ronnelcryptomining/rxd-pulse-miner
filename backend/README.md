# RXD Pulse backend

Records claims / quests in SQLite and queues on-chain RXD sends from a treasury wallet via `@radiant-core/sdk`.

## Setup

```bash
cd backend
cp .env.example .env
npm install
```

Edit `.env`:

- `TREASURY_MNEMONIC` — Photonic / Radiant 24-word phrase for the **payout** wallet only
- `PAYOUT_DRY_RUN=true` until you are ready
- `ADMIN_KEY` — random secret for `/api/admin/stats`
- community URLs

Run two processes:

```bash
npm start          # API + static frontend on :8787
npm run worker     # drains payout queue
```

Open http://localhost:8787

Admin:

```bash
curl -H "x-admin-key: change-me" http://localhost:8787/api/admin/stats
```

## How payouts work

1. `/api/claim` and `/api/quest/:name` insert a `queued` row
2. Worker picks the oldest queued job
3. If `PAYOUT_DRY_RUN=true` it marks `dry_run` and does not broadcast
4. If `PAYOUT_DRY_RUN=false` it builds a ref-safe RXD transfer and broadcasts

## Fees (important)

Radiant mainnet min-relay is about **10,000 photons/byte** (~0.025 RXD for a normal send).  
Paying **0.001 RXD** per tap can cost more in fees than the reward. Options:

- raise `CLAIM_RXD`
- batch claims in the worker later
- keep dry-run until treasury math works

## Security

- Put the mnemonic only on the server. Never in the Mini App.
- Use a dedicated treasury wallet, not your main stack.
- Start with dry-run and a tiny treasury balance.
- Quests are self-reported in this version. Add Telegram `getChatMember` before paying 50 RXD live.
