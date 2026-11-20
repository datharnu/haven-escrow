/**
 * Scene 4. Deliver escrow B's only milestone, refuse autoRelease before the
 * 120 second review, then let the chain clock pass and autoRelease from spike.
 * Sweep a recorded surplus only when no milestone is still unfunded.
 */
import { readFileSync } from "node:fs";
import { getAddress, type Address } from "viem";
import { escrowAbi, signDeliver } from "../src/ts/escrow.js";
import { commitmentOf, sealDeliverable } from "../src/ts/deliverable.js";
import { evmClient, loadAccount, pricedCall, sendPriced, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";
import {
  CLIENT,
  FREELANCER,
  SPIKE,
  Status,
  authDeadline,
  autoReleaseData,
  cardRecipient,
  chainTime,
  deliverData,
  fusdOf,
  held,
  loadManifest,
  milestone,
  nonces,
  printBalanceDelta,
  refuse,
  saveManifest,
  signerOf,
  sweepData,
  writeJson,
  type Tx,
} from "./lib/live.js";

const REPORT = "deployments/scene-4-timeout.json";

type Report = {
  network: string;
  ranAt?: string;
  ok: boolean;
  deliverable?: string;
  freelancerBefore?: string;
  swept?: { escrow: Address; hash: string }[];
  transactions: Tx[];
};

function load(): Report {
  try {
    return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
  } catch {
    return { network: "qorechain-diana", ok: false, transactions: [] };
  }
}

function inputs(): { escrowA: Address; escrowB: Address; arbiters: { name: string }[] } {
  const escrow = JSON.parse(readFileSync("deployments/escrow.json", "utf8")) as {
    ok?: boolean;
    escrowA?: Address;
    escrowB?: Address;
    arbiters?: { name: string }[];
  };
  const scene = JSON.parse(readFileSync("deployments/scene-3-dispute.json", "utf8")) as { ok?: boolean };
  if (!escrow.ok || !escrow.escrowA || !escrow.escrowB || !escrow.arbiters || !scene.ok) throw new Error("scene 3 is not ok");
  return { escrowA: escrow.escrowA, escrowB: escrow.escrowB, arbiters: escrow.arbiters };
}

async function sweepSurplus(escrow: Address, report: Report): Promise<void> {
  const balance = await fusdOf(escrow);
  const locked = await held(escrow);
  if (balance === 0n || balance === locked) return;
  const count = await evmClient().readContract({ address: escrow, abi: escrowAbi, functionName: "milestoneCount" });
  for (let m = 0n; m < count; m++) {
    const row = await milestone(escrow, m);
    if (row.status === Status.Unfunded) throw new Error(`${escrow} still has an unfunded milestone, so sweep would revert`);
  }
  if (balance < locked) throw new Error(`${escrow} balance ${balance} is below held ${locked}`);
  const data = sweepData();
  const opened = await withEvmWindow(
    SPIKE,
    { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrow], blocks: 200 },
    async (account) => {
      const priced = await pricedCall({ from: getAddress(account.evm), to: escrow, data, kind: "call", label: `sweep ${escrow}` });
      return sendPriced({ account, to: escrow, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: `sweep ${escrow}` });
    },
  );
  report.swept = [...(report.swept ?? []), { escrow, hash: opened.result.hash }];
  report.transactions.push(
    { hash: opened.openHash, tier: "pqc", note: `spike opens window to sweep ${escrow}` },
    { hash: opened.result.hash, tier: "classical", note: `sweep ${escrow} gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
    { hash: opened.closeHash, tier: "pqc", note: "close sweep window" },
  );
  writeJson(REPORT, report);
}

async function main(): Promise<void> {
  const report = load();
  if (report.ok) throw new Error("already ran");
  const { escrowA, escrowB, arbiters } = inputs();
  const freelancer = await loadAccount(FREELANCER);
  if (!report.freelancerBefore) {
    report.freelancerBefore = (await fusdOf(getAddress(freelancer.evm))).toString();
    writeJson(REPORT, report);
  }

  if ((await milestone(escrowB, 0n)).status === Status.Funded) {
    const manifest = report.deliverable
      ? loadManifest(report.deliverable)
      : await (async () => {
          const client = await cardRecipient(CLIENT);
          const recipients = await Promise.all(arbiters.map((who) => cardRecipient(who.name)));
          if (recipients.length !== 3) throw new Error("escrow B does not have 3 arbiters");
          const file = new TextEncoder().encode(JSON.stringify({ milestone: 0, work: "logo v1" }));
          const sealed = await sealDeliverable({
            file,
            fileName: "milestone-0.json",
            escrow: escrowB,
            m: 0n,
            client,
            arbiters: [recipients[0], recipients[1], recipients[2]],
          });
          report.deliverable = saveManifest(sealed);
          writeJson(REPORT, report);
          return sealed;
        })();
    const deadline = await authDeadline();
    const sig = signDeliver(signerOf(freelancer), {
      escrow: escrowB,
      m: 0n,
      commitment: commitmentOf(manifest),
      nonce: (await nonces(escrowB)).freelancer,
      deadline,
    });
    const data = deliverData(0n, commitmentOf(manifest), deadline, sig);
    const opened = await withEvmWindow(
      FREELANCER,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowB], blocks: 200 },
      async (account) => {
        const priced = await pricedCall({ from: getAddress(account.evm), to: escrowB, data, kind: "call", label: "deliver B m0" });
        return sendPriced({ account, to: escrowB, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "deliver B m0" });
      },
    );
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "freelancer opens window [B] for deliver m0" },
      { hash: opened.result.hash, tier: "classical", note: `deliver B m0 gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
      { hash: opened.closeHash, tier: "pqc", note: "freelancer closes deliver B window" },
    );
    writeJson(REPORT, report);
  }

  const delivered = await milestone(escrowB, 0n);
  const earlyRecorded = report.transactions.some((tx) => tx.note.includes("autoRelease before review"));
  if (delivered.status === Status.Delivered && !earlyRecorded) {
    if ((await chainTime()) > delivered.deliveredAt + 120n) {
      throw new Error("the review has already passed and the TooEarly refusal was not recorded");
    }
    const data = autoReleaseData(0n);
    const opened = await withEvmWindow(
      SPIKE,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowB], blocks: 200 },
      async (account) => refuse({ account, to: escrowB, data, kind: "call", label: "autoRelease too early" }),
    );
    if (opened.result.errorName !== "TooEarly") throw new Error(`early autoRelease reverted ${opened.result.errorName}`);
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "spike opens window [B] for the early autoRelease" },
      { hash: opened.result.hash, tier: "refused", note: `autoRelease before review -> ${opened.result.errorName}` },
      { hash: opened.closeHash, tier: "pqc", note: "spike closes the early autoRelease window" },
    );
    writeJson(REPORT, report);
    console.log(`early autoRelease refused: ${opened.result.errorName}`);
  }

  const readyAt = (await milestone(escrowB, 0n)).deliveredAt + 120n;
  while ((await milestone(escrowB, 0n)).status === Status.Delivered && (await chainTime()) <= readyAt) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if ((await milestone(escrowB, 0n)).status === Status.Delivered) {
    const data = autoReleaseData(0n);
    const opened = await withEvmWindow(
      SPIKE,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowB], blocks: 200 },
      async (account) => {
        const priced = await pricedCall({ from: getAddress(account.evm), to: escrowB, data, kind: "call", label: "autoRelease B m0" });
        return sendPriced({ account, to: escrowB, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "autoRelease B m0" });
      },
    );
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "spike opens window [B] after the review" },
      { hash: opened.result.hash, tier: "classical", note: `autoRelease B m0 gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
      { hash: opened.closeHash, tier: "pqc", note: "spike closes the autoRelease window" },
    );
    writeJson(REPORT, report);
  }
  if ((await milestone(escrowB, 0n)).status !== Status.Released) throw new Error("B m0 did not autoRelease");
  const delta = (await fusdOf(getAddress(freelancer.evm))) - BigInt(report.freelancerBefore ?? "0");
  if (delta !== 1_000_000n) throw new Error(`freelancer fUSD rose by ${delta}, expected 1000000`);

  await sweepSurplus(escrowA, report);
  await sweepSurplus(escrowB, report);
  const leftA = await fusdOf(escrowA);
  const leftB = await fusdOf(escrowB);
  if (leftA !== 0n || leftB !== 0n) throw new Error(`escrow balances A ${leftA} B ${leftB}`);
  report.ok = true;
  report.ranAt = new Date().toISOString();
  writeJson(REPORT, report);
  console.log(`B m0 auto-released. Freelancer fUSD +${delta}. Both escrows hold 0 fUSD.`);
  await printBalanceDelta();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
