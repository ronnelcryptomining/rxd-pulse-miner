try { await import("dotenv/config"); } catch {}
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import {
  upsertUser,
  getUser,
  setLastClaim,
  startQuest,
  getQuest,
  completeQuest,
  enqueuePayout,
  userState,
  adminStats,
  disconnectUser,
  findByRef,
  maybePayReferrer,
  touchStreak,
  markBlitz,
  blitzUnlocked,
  leaderboard,
  referralLeaders,
  resetAll,
  wave1Complete,
  wave2Complete,
  wave2ClaimedCount,
  resolveUserId,
  markSurge,
  surgeReady,
  restoreScore,
  findByAddress,
  markTelegramMember,
  resetSeason,
} from "./db.js";
import { dryRun, treasuryAddress, treasuryBalance } from "./payout.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(here, "../..");
const localPublic = path.resolve(here, "../public");
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(gameRoot));
app.use(express.static(localPublic));
app.get("/", (_req, res) => {
  const a = path.join(gameRoot, "index.html");
  const b = path.join(localPublic, "index.html");
  if (fs.existsSync(a)) return res.sendFile(a);
  if (fs.existsSync(b)) return res.sendFile(b);
  res.status(404).send("index.html not found. Put it next to the backend folder.");
});

const CLAIM_MS = Number(process.env.CLAIM_COOLDOWN_MS || 60 * 60 * 1000);
const CLAIM_RXD = Number(process.env.CLAIM_RXD || 10);
const QUEST1_RXD = Number(process.env.QUEST1_RXD || 50);
const QUEST2_RXD = Number(process.env.QUEST2_RXD || 10);
const REF_RXD = Number(process.env.REF_RXD || 500);
const WAVE1_MS = Number(process.env.WAVE1_COOLDOWN_MS || 24 * 60 * 60 * 1000);
const WAVE2_MS = Number(process.env.WAVE2_COOLDOWN_MS || 4 * 60 * 60 * 1000);
const VERIFY_MS = Number(process.env.QUEST_VERIFY_MS || 40 * 1000);
const VERIFY2_MS = Number(process.env.QUEST2_VERIFY_MS || 50 * 1000);
const WAVE1 = ["discord", "telegram", "x", "youtube", "facebook"];
const WAVE2 = ["visit_yt", "visit_yt2", "visit_x", "visit_fb", "visit_web"];
const QUESTS = {
  discord: process.env.DISCORD_URL || "https://discord.gg/radiantblockchain",
  telegram: process.env.TELEGRAM_CHANNEL || "https://t.me/rxdpulseminer",
  x: process.env.X_URL || "https://x.com/rxdpulseminer?s=11",
  youtube: process.env.YOUTUBE_URL || "https://youtube.com/@rxdpulseminer?si=bNyjQ3OXjbaZlGuU",
  facebook: process.env.FACEBOOK_URL || "https://www.facebook.com/share/1DsG5GnaJF/?mibextid=wwXIfr",
  visit_yt: process.env.VISIT_YT_URL || "https://youtu.be/oPNhgJrurh8?si=e5z_aDMqo4VLHv7R",
  visit_yt2: process.env.VISIT_YT2_URL || "https://youtu.be/cEmHmYxpVW8?si=K3827AWLqAhjyTp9",
  visit_x: process.env.VISIT_X_URL || "https://youtu.be/V2CXj8cHaBc?si=Lh3w_rJ1DSBnTbp6",
  visit_fb: process.env.VISIT_FB_URL || "https://x.com/rxdpulseminer/status/2103568263171219761?s=46",
  visit_web: process.env.VISIT_WEB_URL || "https://radiantblockchain.org/",
};
const BOT_USERNAME = (process.env.BOT_USERNAME || "").replace(/^@/, "");
const MINI_APP_NAME = process.env.MINI_APP_NAME || "app";
const PAYOUT_CLAIM_ENABLED = process.env.PAYOUT_CLAIM_ENABLED === "true";
const BLITZ_TEST = process.env.BLITZ_TEST === "true";

function normalizeAddr(v) {
  return String(v || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, "").trim();
}

function looksLikeAddress(v) {
  const s = normalizeAddr(v);
  if (!s || s.length < 20 || s.length > 80) return false;
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return false;
  if (/seed|mnemonic|password/i.test(s)) return false;
  if (/^(radaddr:|bitcoincash:|radiant:)/i.test(s)) return true;
  if (/^rxd1[a-z0-9]{20,}$/i.test(s)) return true;
  if (/^[13][a-zA-Z0-9]{24,48}$/.test(s)) return true;
  return false;
}

function userIdFromReq(req) {
  const body = req.body || {};
  const query = req.query || {};
  return resolveUserId({
    telegramId: body.telegramId || query.telegramId || req.headers["x-telegram-id"],
    clientId: body.clientId || query.clientId || req.headers["x-client-id"],
    address: body.address || query.address || req.headers["x-wallet-address"],
  });
}

function verifyMs(name) {
  return WAVE2.includes(name) ? VERIFY2_MS : VERIFY_MS;
}

async function requireTelegramMember(user) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "";
  const chat = process.env.TELEGRAM_CHANNEL_ID || "@rxdpulseminer";
  const tg = user && user.telegram_id;
  if (!tg) {
    const err = new Error("Open the game inside Telegram to join the channel");
    err.status = 400;
    throw err;
  }
  if (!token) {
    const err = new Error("Telegram check is not set up yet. Add TELEGRAM_BOT_TOKEN on Render.");
    err.status = 503;
    throw err;
  }
  const url = "https://api.telegram.org/bot" + token + "/getChatMember?chat_id=" + encodeURIComponent(chat) + "&user_id=" + encodeURIComponent(tg);
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  const status = data && data.result && data.result.status;
  const ok = ["creator", "administrator", "member", "restricted"].includes(status);
  if (!ok) {
    const err = new Error("Join https://t.me/rxdpulseminer first, then try CLAIM again");
    err.status = 403;
    throw err;
  }
  markTelegramMember(user.id);
  return true;
}

function questReward(name) {
  if (WAVE2.includes(name)) return QUEST2_RXD;
  return QUEST1_RXD;
}

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function payReferrerIfReady(user) {
  const referrer = maybePayReferrer(user);
  if (!referrer || !referrer.address) return;
  enqueuePayout({
    userId: referrer.id,
    address: referrer.address,
    kind: "referral",
    amountRxd: REF_RXD,
  });
}

app.get("/api/config", (_req, res) => {
  res.json({
    claimMs: CLAIM_MS,
    claimRxd: CLAIM_RXD,
    quest1Rxd: QUEST1_RXD,
    quest2Rxd: QUEST2_RXD,
    refRxd: REF_RXD,
    wave1Ms: WAVE1_MS,
    wave2Ms: WAVE2_MS,
    verifyMs: VERIFY_MS,
    verify2Ms: VERIFY2_MS,
    quests: QUESTS,
    dryRun,
    payoutClaimEnabled: PAYOUT_CLAIM_ENABLED,
    photonic: "https://photonic-wallet.com",
    botUsername: BOT_USERNAME,
    miniAppName: MINI_APP_NAME,
  });
});

const connectHits = new Map();
function rateLimit(id) {
  const now = Date.now();
  const last = connectHits.get(id) || 0;
  if (now - last < 4000) return false;
  connectHits.set(id, now);
  return true;
}

app.post("/api/connect", (req, res) => {
  try {
    const telegramId = req.body.telegramId || req.headers["x-telegram-id"];
    const username = String(req.body.telegramUsername || "").replace(/^@/, "").trim();
    const id = userIdFromReq(req);
    const address = normalizeAddr(req.body.address || "");
    const existing = getUser(id);
    const byAddr = findByAddress(address);
    const ownWallet = !!(address && existing && (existing.address === address || existing.last_address === address))
      || !!(address && byAddr && existing && byAddr.id === existing.id);
    if (!address || (!ownWallet && !looksLikeAddress(address))) {
      return res.status(400).json({ error: "Only a Photonic RXD receive address is accepted" });
    }
    if (!ownWallet && !rateLimit(id)) return res.status(429).json({ error: "Wait a few seconds and try again" });
    const rawRef = String(req.body.ref || req.body.startParam || "").trim().toUpperCase();
    const referredBy = rawRef && findByRef(rawRef) ? rawRef : "";
    upsertUser(id, address, {
      verified: true,
      referredBy,
      telegramId: telegramId ? String(telegramId) : "",
      telegramUsername: username,
      telegramName: String(req.body.telegramName || "").slice(0, 64),
    });
    restoreScore(id, req.body.savedScore);
    touchStreak(id);
    res.json(userState(id));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/disconnect", (req, res) => {
  try {
    const id = userIdFromReq(req);
    disconnectUser(id);
    const state = userState(id);
    res.json({ ok: true, address: "", disconnected: true, ...(state || {}) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get("/api/me", (req, res) => {
  try {
    const id = userIdFromReq(req);
    restoreScore(id, req.query.savedScore || req.body?.savedScore);
    touchStreak(id);
    const state = userState(id);
    if (!state) return res.status(404).json({ error: "Not connected", disconnected: true });
    res.json({
      ...state,
      disconnected: !state.address,
      nextClaimAt: state.lastClaimAt ? state.lastClaimAt + CLAIM_MS : 0,
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

function bindWallet(req, id) {
  const address = String(req.body?.address || "").trim();
  let user = getUser(id);
  if ((!user || !user.address) && looksLikeAddress(address)) {
    upsertUser(id, address, {
      verified: true,
      telegramId: req.body?.telegramId || req.headers["x-telegram-id"] || "",
      telegramUsername: req.body?.telegramUsername || "",
      telegramName: String(req.body?.telegramName || "").slice(0, 64),
    });
    user = getUser(id);
  }
  if (user && !user.verified && user.address) {
    user.verified = true;
  }
  return user;
}

app.post("/api/claim", (req, res) => {
  try {
    const id = userIdFromReq(req);
    const user = bindWallet(req, id);
    if (!user || !user.address) return res.status(400).json({ error: "Connect a wallet first" });
    const now = Date.now();
    if (user.last_claim_at && now - user.last_claim_at < CLAIM_MS) {
      return res.status(429).json({
        error: "Too soon",
        nextClaimAt: user.last_claim_at + CLAIM_MS,
      });
    }
    setLastClaim(id, now);
    touchStreak(id);
    const payoutId = enqueuePayout({
      userId: id,
      address: user.address,
      kind: "claim",
      amountRxd: CLAIM_RXD,
    });
    payReferrerIfReady(getUser(id));
    res.json({ ok: true, payoutId, amountRxd: CLAIM_RXD, state: userState(id) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/blitz", (req, res) => {
  try {
    const id = userIdFromReq(req);
    const user = bindWallet(req, id);
    if (!user || !user.address) return res.status(400).json({ error: "Connect a wallet first" });
    touchStreak(id);
    const kind = req.body.kind === "wave2" ? "wave2" : "streak";
    const allowed = kind === "wave2" ? wave2Complete(id) : blitzUnlocked(id);
    if (!BLITZ_TEST && !allowed) return res.status(403).json({ error: "Locked" });
    const hits = Math.max(0, Math.min(80, Number(req.body.hits || 0)));
    const amountRxd = hits * 1;
    markBlitz(id, kind);
    if (amountRxd > 0) {
      enqueuePayout({
        userId: id,
        address: user.address,
        kind: "blitz",
        amountRxd,
      });
    }
    res.json({ ok: true, amountRxd, state: userState(id) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/surge", (req, res) => {
  try {
    const id = userIdFromReq(req);
    const user = bindWallet(req, id);
    if (!user || !user.address) return res.status(400).json({ error: "Connect a wallet first" });
    if (!surgeReady(id)) return res.status(429).json({ error: "Surge cooling down" });
    const hits = Math.max(0, Math.min(120, Number(req.body.hits || 0)));
    const amountRxd = Number((hits * 0.02).toFixed(2));
    markSurge(id);
    if (amountRxd > 0) {
      enqueuePayout({
        userId: id,
        address: user.address,
        kind: "surge",
        amountRxd,
      });
    }
    res.json({ ok: true, amountRxd, state: userState(id) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/quest/:name/start", async (req, res) => {
  try {
    const name = req.params.name;
    if (!QUESTS[name]) return res.status(400).json({ error: "Unknown quest" });
    const id = userIdFromReq(req);
    const user = bindWallet(req, id);
    if (!user || !user.address) return res.status(400).json({ error: "Connect a wallet first" });
    await requireTelegramMember(user);
    const row = startQuest(id, name);
    res.json({ ok: true, startedAt: row.started_at, verifyMs: verifyMs(name) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/quest/:name", async (req, res) => {
  try {
    const name = req.params.name;
    if (!QUESTS[name]) return res.status(400).json({ error: "Unknown quest" });
    const id = userIdFromReq(req);
    const user = bindWallet(req, id);
    if (!user || !user.address) return res.status(400).json({ error: "Connect a wallet first" });
    await requireTelegramMember(user);
    const row = getQuest(id, name);
    const need = verifyMs(name);
    if (!row || !row.started_at || row.started_at <= (row.completed_at || 0)) {
      return res.status(400).json({ error: "Tap Go first, then wait for CLAIM" });
    }
    if (Date.now() - row.started_at < need) {
      return res.status(429).json({ error: "Still verifying" });
    }
    const wasDone = wave2Complete(id);
    const resetAt = WAVE1.includes(name) ? (user.wave1_reset_at || 0) : (user.wave2_reset_at || 0);
    const cooldown = WAVE2.includes(name) ? WAVE2_MS : 0;
    const first = completeQuest(id, name, cooldown, WAVE1.includes(name), resetAt);
    if (!first) return res.status(409).json({ error: "Quest on cooldown" });
    const amountRxd = questReward(name);
    const payoutId = enqueuePayout({
      userId: id,
      address: user.address,
      kind: `quest:${name}`,
      amountRxd,
    });
    res.json({
      ok: true,
      payoutId,
      amountRxd,
      url: QUESTS[name],
      pulseReady: !wasDone && wave2ClaimedCount(id) === 5,
      wave2Claimed: wave2ClaimedCount(id),
      state: userState(id),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/admin/reset-season", requireAdmin, (_req, res) => {
  res.json(resetSeason());
});

app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
  try {
    const stats = adminStats();
    let treasury = null;
    try {
      treasury = await treasuryBalance();
    } catch (err) {
      treasury = { error: err.message, address: treasuryAddress() };
    }
    res.json({ dryRun, treasury, ...stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/leaderboard", (_req, res) => {
  res.json({ players: leaderboard(20), referrals: referralLeaders(5) });
});

app.post("/api/dev/reset", (_req, res) => {
  resetAll();
  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ ok: true, dryRun }));

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`RXD Pulse API on :${port} dryRun=${dryRun}`);
});
