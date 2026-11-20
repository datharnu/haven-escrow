/**
 * Scene 3. The client disputes milestone 1. Arbiter 1 and arbiter 2 open the
 * sealed file. A resolve signed only by arbiter 1 is TooFew. Arbiter 3 then
 * submits a 7000 bps resolve signed by arbiter 1 and arbiter 2.
 */
import { readFileSync } from "node:fs";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import { signDispute, signResolve } from "../src/ts/escrow.js";
import { openShare, openWithShares } from "../src/ts/deliverable.js";
import { loadAccount, pricedCall, sendPriced, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";
import {
  CLIENT,
  Status,
  authDeadline,
  disputeData,
  fusdOf,
  loadManifest,
  milestone,
  nonces,
  refuse,
  resolveData,
  sealKeys,
  shareOf,
  signerOf,
  writeJson,
  type Tx,
} from "./lib/live.js";

const REPORT = "deployments/scene-3-dispute.json";

type Report = {
  network: string;
  ranAt?: string;
  ok: boolean;
  opened?: { plaintextHash: Hex; oneShareRefused: boolean };
  clientBefore?: string;
  freelancerBefore?: string;
  transactions: Tx[];
};

function load(): Report {
  try {
    return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
  } catch {
    return { network: "qorechain-diana", ok: false, transactions: [] };
  }
}

function inputs(): { escrowA: Address; manifest: string; arbiters: { name: string; evm: Address }[] } {
  const escrow = JSON.parse(readFileSync("deployments/escrow.json", "utf8")) as {
    ok?: boolean;
    escrowA?: Address;
    arbiters?: { name: string; evm: Address }[];
  };
  const scene = JSON.parse(readFileSync("deployments/scene-1.json", "utf8")) as { ok?: boolean; deliverable1?: string };
  const rehearse = JSON.parse(readFileSync("deployments/scene-2-rehearse.json", "utf8")) as { ok?: boolean };
  if (!escrow.ok || !escrow.escrowA || !escrow.arbiters || !scene.ok || !scene.deliverable1 || !rehearse.ok) {
    throw new Error("scene 2 is not ok");
  }
  return { escrowA: escrow.escrowA, manifest: scene.deliverable1, arbiters: escrow.arbiters };
}

async function main(): Promise<void> {
  const report = load();
  if (report.ok) throw new Error("already ran");
  const { escrowA, manifest: manifestPath, arbiters } = inputs();
  const manifest = loadManifest(manifestPath);
  const client = await loadAccount(CLIENT);
  const arb1 = await loadAccount("escrow-arb-1");
  const arb2 = await loadAccount("escrow-arb-2");

  const current = await milestone(escrowA, 1n);
  if (current.status === Status.Delivered) {
    const deadline = await authDeadline();
    const sig = signDispute(signerOf(client), {
      escrow: escrowA,
      m: 1n,
      byClient: true,
      nonce: (await nonces(escrowA)).client,
      deadline,
    });
    const data = disputeData(1n, true, deadline, sig);
    const opened = await withEvmWindow(
      CLIENT,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowA], blocks: 200 },
      async (account) => {
        const priced = await pricedCall({ from: getAddress(account.evm), to: escrowA, data, kind: "call", label: "dispute A m1" });
        return sendPriced({ account, to: escrowA, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "dispute A m1" });
      },
    );
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "client opens window [A] for dispute m1" },
      { hash: opened.result.hash, tier: "classical", note: `dispute A m1 gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
      { hash: opened.closeHash, tier: "pqc", note: "client closes dispute window" },
    );
    writeJson(REPORT, report);
  }
  if ((await milestone(escrowA, 1n)).status !== Status.Disputed && (await milestone(escrowA, 1n)).status !== Status.Resolved) {
    throw new Error(`A m1 is not disputed`);
  }

  if (!report.opened) {
    const index = (name: string): 0 | 1 | 2 => {
      const found = arbiters.findIndex((who) => who.name === name);
      if (found < 0 || found > 2) throw new Error(`${name} is not an arbiter of this escrow`);
      return found as 0 | 1 | 2;
    };
    const share1 = openShare(manifest, index("escrow-arb-1"), sealKeys("escrow-arb-1"));
    const share2 = openShare(manifest, index("escrow-arb-2"), sealKeys("escrow-arb-2"));
    let oneShareRefused = false;
    try {
      await openWithShares(manifest, [share1]);
    } catch (error) {
      oneShareRefused = error instanceof Error && error.message.includes("two arbiter shares");
    }
    if (!oneShareRefused) throw new Error("one arbiter share reconstructed the file");
    const file = await openWithShares(manifest, [share1, share2]);
    if (keccak256(file) !== manifest.plaintextHash) throw new Error("opened file does not match plaintextHash");
    report.opened = { plaintextHash: manifest.plaintextHash, oneShareRefused: true };
    writeJson(REPORT, report);
  }

  if ((await milestone(escrowA, 1n)).status === Status.Disputed) {
    if (!report.clientBefore) {
      report.clientBefore = (await fusdOf(getAddress(client.evm))).toString();
      report.freelancerBefore = (await fusdOf(getAddress((await loadAccount("escrow-freelancer")).evm))).toString();
      writeJson(REPORT, report);
    }
    const nonce = (await nonces(escrowA)).arbiter;
    const deadline = await authDeadline();
    const fields = { escrow: escrowA, m: 1n, nonce, deadline, splitBps: 7000 };
    const one = signResolve([shareOf(arb1)], fields);
    const both = signResolve([shareOf(arb1), shareOf(arb2)], fields);
    const opened = await withEvmWindow(
      "escrow-arb-3",
      { txs: 2, maxValueUqor: (WINDOW_CAP.resolve * 2n).toString(), targets: [escrowA], blocks: 200 },
      async (account) => {
        const tooFew = await refuse({
          account,
          to: escrowA,
          data: resolveData(1n, 7000, deadline, one.who, one.signatures),
          kind: "call",
          label: "resolve with one arbiter",
        });
        if (tooFew.errorName !== "TooFew") throw new Error(`one-arbiter resolve reverted ${tooFew.errorName}`);
        const data = resolveData(1n, 7000, deadline, both.who, both.signatures);
        const priced = await pricedCall({
          from: getAddress(account.evm),
          to: escrowA,
          data,
          kind: "resolve",
          label: "resolve A m1",
        });
        const sent = await sendPriced({
          account,
          to: escrowA,
          data,
          gas: priced.gas,
          gasPrice: priced.gasPrice,
          kind: "resolve",
          label: "resolve A m1",
        });
        return { tooFew, sent };
      },
    );
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "arb-3 opens window [A] for resolve" },
      { hash: opened.result.tooFew.hash, tier: "refused", note: `resolve with only arb-1 -> ${opened.result.tooFew.errorName}` },
      {
        hash: opened.result.sent.hash,
        tier: "classical",
        note: `arb-3 submits resolve(1, 7000) signed by arb-1 and arb-2 gasUsed ${opened.result.sent.gasUsed} fee ${opened.result.sent.uqor} uqor`,
      },
      { hash: opened.closeHash, tier: "pqc", note: "arb-3 closes resolve window" },
    );
    writeJson(REPORT, report);
  }

  if ((await milestone(escrowA, 1n)).status !== Status.Resolved) throw new Error("A m1 did not resolve");
  const clientDelta = (await fusdOf(getAddress(client.evm))) - BigInt(report.clientBefore ?? "0");
  const freelancerDelta = (await fusdOf(getAddress((await loadAccount("escrow-freelancer")).evm))) - BigInt(report.freelancerBefore ?? "0");
  if (freelancerDelta !== 700_000n) throw new Error(`freelancer fUSD rose by ${freelancerDelta}, expected 700000`);
  if (clientDelta !== 300_000n) throw new Error(`client fUSD rose by ${clientDelta}, expected 300000`);
  report.ok = true;
  report.ranAt = new Date().toISOString();
  writeJson(REPORT, report);
  console.log(`resolved 700000 to the freelancer and 300000 to the client`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
