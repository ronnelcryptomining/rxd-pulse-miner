import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const dir = path.resolve("data");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "pulse.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { users: {}, quests: {}, payouts: [], activities: [], nextPayoutId: 1 };
  }
}

function save(db) {
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
}

let db = load();

function makeCode(id) {
  const hash = crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 6).toUpperCase();
  return "RXD" + hash;
}

function ensureUserFields(user) {
  if (!user.referral_code) user.referral_code = makeCode(user.id);
  if (user.referred_by === undefined) user.referred_by = "";
  if (user.verified === undefined) user.verified = false;
  if (user.mine_count === undefined) user.mine_count = 0;
  if (user.referral_paid === undefined) user.referral_paid = false;
  if (user.streak === undefined) user.streak = 0;
  if (user.last_active_day === undefined) user.last_active_day = "";
  if (user.last_blitz_day === undefined) user.last_blitz_day = "";
  if (user.wave1_reset_at === undefined) user.wave1_reset_at = 0;
  if (user.wave2_reset_at === undefined) user.wave2_reset_at = 0;
  if (user.blitz_count === undefined) user.blitz_count = 0;
  if (user.streak_blitz_used === undefined) user.streak_blitz_used = false;
  if (user.score === undefined) user.score = 0;
  if (user.last_surge_at === undefined) user.last_surge_at = 0;
  if (user.surge_count === undefined) user.surge_count = 0;
  if (user.last_address === undefined) user.last_address = user.address || "";
  if (user.wave2_epoch !== 3) {
    user.wave2_epoch = 3;
    user.wave2_reset_at = Date.now();
  }
  return user;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayKey() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

export function touchStreak(id) {
  const user = getUser(id);
  if (!user) return null;
  const today = todayKey();
  if (user.last_active_day === today) return user;
  if (user.last_active_day === yesterdayKey()) user.streak = (user.streak || 0) + 1;
  else {
    user.streak = 1;
    user.streak_blitz_used = false;
  }
  user.last_active_day = today;
  if (user.streak === 3) user.wave1_reset_at = Date.now();
  save(db);
  return user;
}

export function markSurge(id) {
  const user = getUser(id);
  if (!user) return null;
  user.last_surge_at = Date.now();
  user.surge_count = (user.surge_count || 0) + 1;
  save(db);
  return user;
}

export function surgeReady(id) {
  const user = getUser(id);
  if (!user || !user.address) return false;
  return Date.now() - (user.last_surge_at || 0) >= 6 * 60 * 60 * 1000;
}

export function markBlitz(id, kind) {
  const user = getUser(id);
  if (!user) return null;
  user.last_blitz_day = todayKey();
  user.blitz_count = (user.blitz_count || 0) + 1;
  if (kind === "streak") user.streak_blitz_used = true;
  if (kind === "wave2") user.wave2_reset_at = Date.now();
  save(db);
  return user;
}

export function logActivity(row) {
  if (!db.activities) db.activities = [];
  db.activities.push(Object.assign({ t: Date.now() }, row));
  if (db.activities.length > 20000) db.activities = db.activities.slice(-15000);
  save(db);
}

export function resetAll() {
  db = { users: {}, quests: {}, payouts: [], activities: [], nextPayoutId: 1 };
  save(db);
}

export function upsertUser(id, address, extra = {}) {
  const taken = Object.values(db.users).find((u) => u.address && u.address === address && u.id !== id);
  if (taken) {
    throw Object.assign(new Error("This wallet is already bound to another Telegram account"), { status: 409 });
  }
  const existing = db.users[id];
  if (existing && existing.address && existing.address !== address) {
    throw Object.assign(new Error("This Telegram account already has a wallet. Disconnect first to change it."), { status: 409 });
  }
  if (existing) {
    ensureUserFields(existing);
    existing.address = address;
    if (extra.telegramId) existing.telegram_id = extra.telegramId;
    if (extra.telegramUsername) existing.telegram_username = extra.telegramUsername;
    if (extra.telegramName) existing.telegram_name = extra.telegramName;
    if (extra.verified) existing.verified = true;
    if (extra.referredBy && !existing.referred_by && extra.referredBy !== existing.referral_code) {
      existing.referred_by = extra.referredBy;
    }
    existing.disconnected_at = 0;
  } else {
    db.users[id] = ensureUserFields({
      id,
      address,
      created_at: Date.now(),
      last_claim_at: 0,
      verified: !!extra.verified,
      referred_by: extra.referredBy || "",
      telegram_id: extra.telegramId || "",
      telegram_username: extra.telegramUsername || "",
      telegram_name: extra.telegramName || "",
      mine_count: 0,
      referral_paid: false,
    });
  }
  save(db);
  return db.users[id];
}

export function restoreScore(id, savedScore) {
  const user = getUser(id);
  if (!user) return null;
  const n = Number(savedScore || 0);
  if (n > 0 && n < 100000000 && Number(user.score || 0) < n) {
    user.score = n;
    save(db);
  }
  return user;
}

export function findByTelegramId(tgId) {
  if (!tgId) return null;
  const key = "tg:" + String(tgId);
  if (db.users[key]) return ensureUserFields(db.users[key]);
  return Object.values(db.users).find((u) => String(u.telegram_id || "") === String(tgId)) || null;
}

export function findByAddress(address) {
  if (!address) return null;
  const a = String(address).trim();
  if (!a) return null;
  return Object.values(db.users).find((u) => (u.address && u.address === a) || (u.last_address && u.last_address === a)) || null;
}

export function resolveUserId({ telegramId, clientId, address }) {
  const tg = telegramId && /^\d{3,20}$/.test(String(telegramId)) ? String(telegramId) : "";
  const web = clientId && /^[a-zA-Z0-9_-]{8,80}$/.test(String(clientId)) ? String(clientId) : "";
  const byAddr = findByAddress(address);
  if (tg) {
    const hit = findByTelegramId(tg);
    if (hit) {
      if (byAddr && byAddr.id !== hit.id && (!byAddr.telegram_id || String(byAddr.telegram_id) === tg)) {
        remapUserId(byAddr.id, hit.id);
        save(db);
      }
      return hit.id;
    }
    if (byAddr) {
      byAddr.telegram_id = tg;
      const dest = "tg:" + tg;
      if (byAddr.id !== dest) remapUserId(byAddr.id, dest);
      save(db);
      return dest;
    }
    const webUser = web ? db.users["web:" + web] : null;
    if (webUser) {
      remapUserId(webUser.id, "tg:" + tg);
      webUser.telegram_id = tg;
      save(db);
      return "tg:" + tg;
    }
    return "tg:" + tg;
  }
  if (byAddr) return byAddr.id;
  if (web) return "web:" + web;
  throw Object.assign(new Error("Missing user id"), { status: 400 });
}

function remapUserId(oldId, newId) {
  if (!oldId || oldId === newId || !db.users[oldId]) return;
  const user = db.users[oldId];
  user.id = newId;
  db.users[newId] = user;
  delete db.users[oldId];
  Object.values(db.quests).forEach((q) => {
    if (q.user_id === oldId) q.user_id = newId;
  });
  Object.keys(db.quests).forEach((key) => {
    if (key.startsWith(oldId + ":")) {
      const q = db.quests[key];
      db.quests[newId + ":" + key.slice(oldId.length + 1)] = q;
      delete db.quests[key];
    }
  });
  (db.payouts || []).forEach((p) => {
    if (p.user_id === oldId) p.user_id = newId;
  });
}

export function getUser(id) {
  const user = db.users[id];
  if (!user) return null;
  return ensureUserFields(user);
}

export function disconnectUser(id) {
  const user = db.users[id];
  if (!user) return null;
  if (user.address) user.last_address = user.address;
  user.address = "";
  user.disconnected_at = Date.now();
  save(db);
  return user;
}

export function findByRef(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  return Object.values(db.users).find((u) => (u.referral_code || "").toUpperCase() === c) || null;
}

export function setLastClaim(id, ts) {
  if (!db.users[id]) return;
  db.users[id].last_claim_at = ts;
  db.users[id].mine_count = (db.users[id].mine_count || 0) + 1;
  save(db);
}

export function listQuests(id) {
  return Object.values(db.quests).filter((q) => q.user_id === id);
}

export function startQuest(id, quest) {
  const key = id + ":" + quest;
  const now = Date.now();
  const row = db.quests[key] || { user_id: id, quest, completed_at: 0, started_at: 0 };
  row.started_at = now;
  db.quests[key] = row;
  save(db);
  return row;
}

export function getQuest(id, quest) {
  return db.quests[id + ":" + quest] || null;
}

export function completeQuest(id, quest, cooldownMs, once, resetAt = 0) {
  const key = id + ":" + quest;
  const now = Date.now();
  const row = db.quests[key] || { user_id: id, quest, completed_at: 0, started_at: 0 };
  const active = row.completed_at > (resetAt || 0);
  if (once && active) return false;
  if (active && cooldownMs && now - row.completed_at < cooldownMs) return false;
  row.completed_at = now;
  db.quests[key] = row;
  save(db);
  return true;
}

export function enqueuePayout({ userId, address, kind, amountRxd }) {
  const row = {
    id: db.nextPayoutId++,
    user_id: userId,
    address,
    kind,
    amount_rxd: String(amountRxd),
    status: "queued",
    txid: null,
    error: null,
    created_at: Date.now(),
    sent_at: null,
  };
  db.payouts.push(row);
  const owner = db.users[userId];
  if (owner) owner.score = Number(owner.score || 0) + Number(amountRxd || 0);
  logActivity({
    userId,
    type: kind,
    amount: Number(amountRxd),
    address,
  });
  save(db);
  return row.id;
}

export function nextQueued() {
  return db.payouts.find((p) => p.status === "queued" || p.status === "retry") || null;
}

export function markPayout(id, fields) {
  const row = db.payouts.find((p) => p.id === id);
  if (!row) return;
  Object.assign(row, fields);
  save(db);
}

export function claimedTotal(id) {
  const user = db.users[id];
  const fromUser = Number((user && user.score) || 0);
  const fromPay = db.payouts
    .filter((p) => p.user_id === id && ["queued", "retry", "sent", "dry_run"].includes(p.status))
    .reduce((sum, p) => sum + Number(p.amount_rxd || 0), 0);
  return Math.max(fromUser, fromPay);
}

export function markTelegramMember(id) {
  const user = getUser(id);
  if (!user) return null;
  user.tg_member = true;
  user.tg_checked_at = Date.now();
  save(db);
  return user;
}

export function resetSeason() {
  const now = Date.now();
  db.season_started_at = now;
  for (const p of db.payouts) {
    if (!p.created_at || p.created_at < now) {
      if (p.status !== "sent") p.status = "archived";
      else p.status = "sent_prev";
    }
  }
  for (const u of Object.values(db.users)) {
    u.score = 0;
    u.referred_by = "";
    u.referral_paid = false;
  }
  save(db);
  return { ok: true, seasonStartedAt: now, users: Object.keys(db.users).length };
}

export function referralCount(code) {
  if (!code) return 0;
  return Object.values(db.users).filter((u) => (u.referred_by || "").toUpperCase() === code.toUpperCase()).length;
}

export function maybePayReferrer(user) {
  if (!user || user.referral_paid || !user.referred_by) return null;
  if (!user.verified || (user.mine_count || 0) < 1) return null;
  const referrer = findByRef(user.referred_by);
  if (!referrer || referrer.id === user.id) return null;
  user.referral_paid = true;
  save(db);
  return referrer;
}

const WAVE2_NAMES = ["visit_yt", "visit_yt2", "visit_x", "visit_fb", "visit_web"];

export function wave1Complete(id) {
  const user = getUser(id);
  const reset = (user && user.wave1_reset_at) || 0;
  const qs = listQuests(id);
  const names = ["discord", "telegram", "x", "youtube", "facebook"];
  return names.every((name) => qs.some((q) => q.quest === name && q.completed_at > reset));
}

export function wave2ClaimedCount(id) {
  const user = getUser(id);
  const reset = (user && user.wave2_reset_at) || 0;
  const qs = listQuests(id);
  return WAVE2_NAMES.filter((name) => qs.some((q) => q.quest === name && q.completed_at > reset)).length;
}

export function wave2Complete(id) {
  return wave2ClaimedCount(id) === WAVE2_NAMES.length;
}

export function blitzUnlocked(id) {
  const user = getUser(id);
  if (!user || !user.address) return false;
  return (user.streak || 0) >= 5 && !user.streak_blitz_used;
}

export function leaderboard(limit = 20) {
  return Object.values(db.users)
    .filter((u) => u.address || Number(u.score || 0) > 0)
    .map((u) => {
      const uname = String(u.telegram_username || "").replace(/^@/, "");
      const name = uname
        ? "@" + uname
        : (u.telegram_name || (u.telegram_id ? "ID " + u.telegram_id : "Player"));
      return {
        name,
        telegramId: u.telegram_id || "",
        score: claimedTotal(u.id),
        streak: u.streak || 0,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function userState(id) {
  const user = getUser(id);
  if (!user) return null;
  return {
    userId: user.id,
    address: user.address || "",
    lastClaimAt: user.last_claim_at,
    claimed: claimedTotal(id),
    quests: listQuests(id),
    referralCode: user.referral_code,
    referrals: referralCount(user.referral_code),
    verified: !!user.verified,
    mineCount: user.mine_count || 0,
    streak: user.streak || 0,
    wave1Reset: user.wave1_reset_at || 0,
    wave2Reset: user.wave2_reset_at || 0,
    wave1Done: wave1Complete(id),
    wave2Done: wave2Complete(id),
    blitzReady: blitzUnlocked(id),
    blitzCount: user.blitz_count || 0,
    payoutEligible: !!user.address
      && claimedTotal(id) >= 1000
      && referralCount(user.referral_code) >= 3
      && !!user.telegram_id
      && !!user.tg_member,
  };
}

export function adminStats() {
  return {
    users: Object.keys(db.users).length,
    queued: db.payouts.filter((p) => p.status === "queued" || p.status === "retry").length,
    sent: db.payouts.filter((p) => p.status === "sent").length,
    failed: db.payouts.filter((p) => p.status === "failed").length,
    pendingRxd: db.payouts
      .filter((p) => p.status === "queued" || p.status === "retry")
      .reduce((sum, p) => sum + Number(p.amount_rxd || 0), 0),
    recent: db.payouts.slice(-25).reverse(),
  };
}
