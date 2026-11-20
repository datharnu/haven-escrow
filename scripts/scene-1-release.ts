/**
 * Scene 1. The freelancer seals milestone 0 and delivers it from their own window.
 * The client opens it and releases it. The freelancer seals milestone 1; spike
 * submits that deliver. Spike is not a signer.
 */
import { readFileSync } from "node:fs";
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { signDeliver, signRelease } from "../src/ts/escrow.js";
import { commitmentOf, openAsClient, sealDeliverable, type Manifest } from "../src/ts/deliverable.js";
import { loadAccount, pricedCall, sendPriced, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";
import {
  CLIENT,
  FREELANCER,
  SPIKE,
  Status,
  authDeadline,
  cardRecipient,
  deliverData,
  fusdOf,
  loadManifest,
  milestone,
  nonces,
  releaseData,
  saveManifest,
  sealKeys,
  signerOf,
  writeJson,
  type Tx,
} from "./lib/live.js";

const REPORT = "deployments/scene-1.json";

type Report = {
  network: string;
  ranAt?: string;
  ok: boolean;
  deliverable0?: string;
  deliverable1?: string;
  releaseSignature?: Hex;
  releaseDeadline?: string;
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

function escrows(): { escrowA: Address } {
  const doc = JSON.parse(readFileSync("deployments/escrow.json", "utf8")) as { ok?: boolean; escrowA?: Address };
  const funding = JSON.parse(readFileSync("deployments/fund-client.json", "utf8")) as { ok?: boolean };
  if (!doc.ok || !doc.escrowA || !funding.ok) throw new Error("escrow A is not funded");
  return { escrowA: doc.escrowA };
}

async function recipients() {
  const client = await cardRecipient(CLIENT);
  const sorted = await Promise.all(
    (JSON.parse(readFileSync("deployments/escrow.json", "utf8")) as { arbiters: { name: string; evm: Address }[] }).arbiters.map(
      async (who) => cardRecipient(who.name),
    ),
  );
  if (sorted.length !== 3) throw new Error(`expected 3 arbiters, found ${sorted.length}`);
  return { client, arbiters: [sorted[0], sorted[1], sorted[2]] as [typeof sorted[0], typeof sorted[0], typeof sorted[0]] };
}

async function sealed(report: Report, key: "deliverable0" | "deliverable1", escrow: Address, m: bigint, work: string): Promise<Manifest> {
  if (report[key]) return loadManifest(report[key]);
  const { client, arbiters } = await recipients();
  const file = toBytes(JSON.stringify({ milestone: Number(m), work }));
  const manifest = await sealDeliverable({ file, fileName: `milestone-${m}.json`, escrow, m, client, arbiters });
  if (keccak256(file) !== manifest.plaintextHash) throw new Error("sealed file hash drifted");
  report[key] = saveManifest(manifest);
  writeJson(REPORT, report);
  return manifest;
}

async function main(): Promise<void> {
  const report = load();
  if (report.ok) throw new Error("already ran");
  const { escrowA } = escrows();
  const freelancer = await loadAccount(FREELANCER);
  const client = await loadAccount(CLIENT);
  if (!report.freelancerBefore) {
    report.freelancerBefore = (await fusdOf(getAddress(freelancer.evm))).toString();
    writeJson(REPORT, report);
  }

  const first = await milestone(escrowA, 0n);
  if (first.status === Status.Funded) {
    const manifest = await sealed(report, "deliverable0", escrowA, 0n, "logo v1");
    const deadline = await authDeadline();
    const sig = signDeliver(signerOf(freelancer), {
      escrow: escrowA,
      m: 0n,
      commitment: commitmentOf(manifest),
      nonce: (await nonces(escrowA)).freelancer,
      deadline,
    });
    const data = deliverData(0n, commitmentOf(manifest), deadline, sig);
    const opened = await withEvmWindow(
      FREELANCER,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowA], blocks: 200 },
      async (account) => {
        const priced = await pricedCall({ from: getAddress(account.evm), to: escrowA, data, kind: "call", label: "deliver A m0" });
        return sendPriced({ account, to: escrowA, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "deliver A m0" });
      },
    );
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "freelancer opens window [A] for deliver m0" },
      { hash: opened.result.hash, tier: "classical", note: `deliver A m0 gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
      { hash: opened.closeHash, tier: "pqc", note: "freelancer closes deliver m0 window" },
    );
    writeJson(REPORT, report);
  }

  const delivered = await milestone(escrowA, 0n);
  if (delivered.status === Status.Delivered) {
    if (!report.deliverable0) throw new Error("A m0 is delivered but the manifest was not saved");
    const manifest = loadManifest(report.deliverable0);
    const openedFile = openAsClient(manifest, sealKeys(CLIENT));
    if (keccak256(openedFile) !== manifest.plaintextHash) throw new Error("client open does not match plaintextHash");
    const deadline = await authDeadline();
    const sig = signRelease(signerOf(client), {
      escrow: escrowA,
      m: 0n,
      amount: delivered.amount,
      nonce: (await nonces(escrowA)).client,
      deadline,
    });
    report.releaseSignature = sig;
    report.releaseDeadline = deadline.toString();
    writeJson(REPORT, report);
    const data = releaseData(0n, deadline, sig);
    const opened = await withEvmWindow(
      CLIENT,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowA], blocks: 200 },
      async (account) => {
        const priced = await pricedCall({ from: getAddress(account.evm), to: escrowA, data, kind: "call", label: "release A m0" });
        return sendPriced({ account, to: escrowA, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "release A m0" });
      },
    );
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "client opens window [A] for release m0" },
      { hash: opened.result.hash, tier: "classical", note: `release A m0 gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
      { hash: opened.closeHash, tier: "pqc", note: "client closes release m0 window" },
    );
    writeJson(REPORT, report);
  }
  if ((await milestone(escrowA, 0n)).status !== Status.Released) throw new Error("A m0 did not release");

  const second = await milestone(escrowA, 1n);
  if (second.status === Status.Funded) {
    const manifest = await sealed(report, "deliverable1", escrowA, 1n, "logo v2");
    const deadline = await authDeadline();
    const sig = signDeliver(signerOf(freelancer), {
      escrow: escrowA,
      m: 1n,
      commitment: commitmentOf(manifest),
      nonce: (await nonces(escrowA)).freelancer,
      deadline,
    });
    const data = deliverData(1n, commitmentOf(manifest), deadline, sig);
    const opened = await withEvmWindow(
      SPIKE,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowA], blocks: 200 },
      async (account) => {
        const priced = await pricedCall({ from: getAddress(account.evm), to: escrowA, data, kind: "call", label: "spike submits deliver A m1" });
        return sendPriced({
          account,
          to: escrowA,
          data,
          gas: priced.gas,
          gasPrice: priced.gasPrice,
          kind: "call",
          label: "spike submits deliver A m1",
        });
      },
    );
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "spike opens window [A]; spike is not the signer" },
      { hash: opened.result.hash, tier: "classical", note: `spike submits freelancer deliver A m1 gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
      { hash: opened.closeHash, tier: "pqc", note: "spike closes deliver m1 window" },
    );
    writeJson(REPORT, report);
  }
  if ((await milestone(escrowA, 1n)).status !== Status.Delivered) throw new Error("A m1 did not deliver");

  const after = await fusdOf(getAddress(freelancer.evm));
  const delta = after - BigInt(report.freelancerBefore ?? "0");
  if (delta !== 1_000_000n) throw new Error(`freelancer fUSD rose by ${delta}, expected 1000000`);
  report.ok = true;
  report.ranAt = new Date().toISOString();
  writeJson(REPORT, report);
  console.log(`A m0 released, A m1 delivered, freelancer fUSD +${delta}`);
  console.log(`release signature stored for the replay`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
