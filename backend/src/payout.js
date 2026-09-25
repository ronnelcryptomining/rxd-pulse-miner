const dryRun = process.env.PAYOUT_DRY_RUN !== "false";

export function treasuryAddress() {
  return process.env.TREASURY_ADDRESS || null;
}

export async function treasuryBalance() {
  return { address: treasuryAddress(), confirmedRxd: "n/a", note: "on-chain send not enabled in this install" };
}

export async function sendRxd(to, amountRxd) {
  return { dryRun: true, txid: null, to, amountRxd };
}

export { dryRun };
