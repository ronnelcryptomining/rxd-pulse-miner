try { await import("dotenv/config"); } catch {}
import { nextQueued, markPayout } from "./db.js";
import { sendRxd, dryRun } from "./payout.js";

const interval = Number(process.env.PAYOUT_INTERVAL_MS || 20_000);

async function tick() {
  const job = nextQueued();
  if (!job) return;
  markPayout(job.id, { status: "sending" });
  try {
    const result = await sendRxd(job.address, job.amount_rxd);
    markPayout(job.id, {
      status: result.dryRun ? "dry_run" : "sent",
      txid: result.txid,
      sent_at: Date.now(),
      error: result.dryRun ? "dry_run" : null,
    });
    console.log(
      result.dryRun
        ? `dry-run payout #${job.id} ${job.amount_rxd} RXD -> ${job.address}`
        : `sent payout #${job.id} ${job.amount_rxd} RXD tx=${result.txid}`
    );
  } catch (err) {
    const retryable = /insufficient|timeout|connect|temporar/i.test(err.message);
    markPayout(job.id, {
      status: retryable ? "retry" : "failed",
      error: String(err.message).slice(0, 500),
    });
    console.error(`payout #${job.id} failed:`, err.message);
  }
}

console.log(`Payout worker started dryRun=${dryRun} every ${interval}ms`);
setInterval(() => tick().catch((err) => console.error(err)), interval);
tick().catch((err) => console.error(err));
