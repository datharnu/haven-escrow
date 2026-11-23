/**
 * Scene 6, the client's receipt on Escrow D (HavenEscrowV2). Run `npm run deploy:v2 -- --broadcast` first.
 *
 *   npm run scene:6                 # plan only: reads the chain, prints every step and its cost, sends nothing
 *   npm run scene:6 -- --broadcast
 *
 * The story: the client receives the file, the client's device signs a Courier receipt for it, and then the
 * client disputes and goes silent. The arbiters stay silent too. Because the client's own receipt is recorded
 * on the escrow, the silent-panel timeout pays the freelancer receivedSplitBps (100%) instead of the 50/50 default.
 *
 * 1. The freelancer seals the milestone file (AES-256-GCM, key sealed to the client's ML-KEM-1024 card and
 *    Shamir-split to the three arbiter cards). Spike relays the freelancer's ML-DSA-87 `deliver`.
 *    With no receipt on Courier's DeliveryReceipts, `acknowledge` reverts NoReceipt.
 * 2. Courier's Carol: a receipt naming the client but signed with Carol's key is refused by DeliveryReceipts
 *    itself (SignatureInvalid); Carol's own valid receipt over the right commitment is stored under Carol.
 * 3. The client's device opens the file with its ML-KEM key and records two receipts signed with its ML-DSA-87
 *    key: counter 1 over keccak256(ciphertext) only, counter 0 over the milestone commitment. Then the client
 *    signs `dispute(0)` and stops.
 * 4. Spike: `resolveTimeout` before the 180 s arbiter timeout reverts TooEarly. `acknowledge` with Carol's
 *    receipt (counter 2) and with the ciphertext-only receipt (counter 1) revert NoReceipt; with the client's
 *    commitment receipt (counter 0) it records `receivedAt`.
 * 5. After the arbiter timeout on the chain clock, spike's `resolveTimeout` pays the freelancer 100%.
 *
 * This script carries the file as a local JSON in deployments/deliverables/. It does not run Courier's relay.
 * The receipt is Courier's on-chain format, recorded on Courier's live DeliveryReceipts.
 */
import { existsSync, readFileSync } from "node:fs";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import { commitmentOf, openAsClient, sealDeliverable, type Manifest } from "../src/ts/deliverable.js";
import { signDeliver, signDispute } from "../src/ts/escrow.js";
import {
  DELIVERY_RECEIPTS,
  clientReceiptFor,
  conversationFor,
  partsOf,
  signCourierReceipt,
  type Parts,
} from "../src/ts/receipt-gate.js";
import { loadAccount, loadSealKeys, pricedCall, sendPriced, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";
import {
  ARBITER_NAMES,
  CLIENT,
  FREELANCER,
  SPIKE,
  Status,
  assertSealKey,
  authDeadline,
  cardRecipient,
  chainTime,
  deliverData,
  disputeData,
  fusdOf,
  loadManifest,
  nonces,
  refuse,
  saveManifest,
  signerOf,
  sortedArbiters,
  writeJson,
} from "./lib/live.js";
import {
  BROADCAST,
  COST,
  COURIER_CAROL,
  accountRows,
  acknowledgeData,
  checkDeliveryReceipts,
  milestoneV2,
  printPlan,
  qor,
  recordData,
  resolveTimeoutData,
  stopUnlessBroadcast,
  storedReceipt,
} from "./lib/gate.js";
import { SCENE6_REPORT, WEB_RECORD, webRecord, type GateStep, type Scene6Report } from "./lib/gate-record.js";
import type { UnifiedAccount } from "@qorechain/sdk";

const M = 0n;
const COUNTER = { client: 0n, ciphertextOnly: 1n, carol: 2n } as const;
const FILE = "Haven Escrow receipt-evidence milestone 0. The client's device receipts this file; a silent panel then pays the freelancer in full.";

type Deploy = { ok?: boolean; factory?: Address; escrowD?: Address; termsD?: { arbiterTimeout: string; receivedSplitBps: number } };

function inputs(): { factory: Address; escrow: Address; timeout: bigint } {
  if (!existsSync("deployments/escrow-v2.json")) throw new Error("deployments/escrow-v2.json is missing; run npm run deploy:v2 first");
  const doc = JSON.parse(readFileSync("deployments/escrow-v2.json", "utf8")) as Deploy;
  if (!doc.ok || !doc.factory || !doc.escrowD || !doc.termsD) throw new Error("deployments/escrow-v2.json is not ok; run npm run deploy:v2 first");
  if (doc.termsD.receivedSplitBps !== 10000) throw new Error("scene 6 expects receivedSplitBps 10000");
  return { factory: getAddress(doc.factory), escrow: getAddress(doc.escrowD), timeout: BigInt(doc.termsD.arbiterTimeout) };
}

function load(): Scene6Report {
  if (!existsSync(SCENE6_REPORT)) return { network: "qorechain-diana", ok: false, steps: [], transactions: [] };
  return JSON.parse(readFileSync(SCENE6_REPORT, "utf8")) as Scene6Report;
}

function done(report: Scene6Report, id: string): boolean {
  return report.steps.some((step) => step.id === id);
}

function save(report: Scene6Report): void {
  writeJson(SCENE6_REPORT, report);
}

async function plan(report: Scene6Report, escrow: Address | undefined): Promise<void> {
  const dr = await checkDeliveryReceipts();
  const rows = await accountRows([SPIKE, CLIENT, FREELANCER, ...ARBITER_NAMES, COURIER_CAROL]);
  const row = escrow ? await milestoneV2(escrow, M) : undefined;
  if (escrow && row) {
    console.log(`Escrow D ${escrow}: milestone 0 status ${row.status}, receivedAt ${row.receivedAt}, holds ${await fusdOf(escrow)} fUSD base units`);
  } else {
    console.log("Escrow D does not exist yet (deployments/escrow-v2.json is missing). The plan below assumes npm run deploy:v2 -- --broadcast ran first.");
  }
  console.log(`DeliveryReceipts ${DELIVERY_RECEIPTS} code hash ${dr.ok ? "matches" : "DOES NOT MATCH"} the Courier build`);
  const steps = [
    "freelancer (local, no transaction): seal the file to the client card and the three arbiter cards; save the manifest",
    "spike: window [D], 2 calls: deliver(0) with the freelancer's ML-DSA-87 signature; acknowledge(0, counter 0) -> NoReceipt",
    "courier-carol: window [DeliveryReceipts], 2 calls: record naming the client signed by Carol's key -> SignatureInvalid; record Carol's own receipt over the commitment (counter 2)",
    "client (local): open the file with the client's ML-KEM-1024 key and check the plaintext hash",
    "client: window [DeliveryReceipts, D], 3 calls: record a receipt over keccak256(ciphertext) (counter 1); record the receipt over the commitment (counter 0); dispute(0) with the client's ML-DSA-87 signature, then silence",
    "spike: window [D], 4 calls: resolveTimeout(0) -> TooEarly; acknowledge(counter 2, Carol) -> NoReceipt; acknowledge(counter 1, ciphertext only) -> NoReceipt; acknowledge(counter 0) -> Received",
    "wait until the chain timestamp passes disputedAt + 180 s, with no arbiter signature",
    "spike: window [D], resolveTimeout(0): receivedSplitBps 10000, so 100,000 fUSD base units to the stored freelancer and 0 to the client",
    `write ${SCENE6_REPORT} and the web copy ${WEB_RECORD}`,
  ];
  const spend: Record<string, bigint> = {
    [SPIKE]: 3n * COST.windowOpenClose + 5n * COST.refusal + 40_000n + 10_000n + 15_000n,
    [COURIER_CAROL]: COST.windowOpenClose + COST.refusal + 35_000n,
    [CLIENT]: COST.windowOpenClose + 70_000n + 30_000n,
  };
  printPlan("Scene 6: the client's receipt decides the silent-panel split on Escrow D", steps, spend, rows);
  if (!dr.ok) throw new Error("DeliveryReceipts code does not match the pinned hash");
  for (const who of rows) if (!who.mlDsa87) throw new Error(`${who.name} has no proven ML-DSA-87 key on chain`);
  for (const who of rows) {
    if ((spend[who.name] ?? 0n) > who.uqor) throw new Error(`${who.name} has ${qor(who.uqor)}, below the estimate`);
  }
  if (row && !report.deliverable && row.status !== Status.Funded) throw new Error(`milestone 0 is status ${row.status}, expected Funded`);
}

async function seal(report: Scene6Report, escrow: Address): Promise<Manifest> {
  if (report.deliverable) return loadManifest(report.deliverable);
  await assertSealKey(CLIENT);
  for (const name of ARBITER_NAMES) await assertSealKey(name);
  const arbiters = await Promise.all((await sortedArbiters()).map((who) => cardRecipient(who.name)));
  const manifest = await sealDeliverable({
    file: new TextEncoder().encode(FILE),
    fileName: "milestone-0.txt",
    escrow,
    m: M,
    client: await cardRecipient(CLIENT),
    arbiters: [arbiters[0], arbiters[1], arbiters[2]],
  });
  report.deliverable = saveManifest(manifest);
  report.commitment = commitmentOf(manifest);
  report.parts = [...partsOf(manifest)];
  report.conversationId = conversationFor(escrow);
  save(report);
  console.log(`sealed ${report.deliverable}`);
  return manifest;
}

type Call = {
  id: string;
  title: string;
  who: string;
  data: Hex;
  to: Address;
  expect?: string;
  outcome?: GateStep["outcome"];
  /** True when the chain shows this step already happened. A step that happened but is not in the report stops the run. */
  landed?: () => Promise<boolean>;
};

/** One window, several calls. A call with `expect` must revert with that error; the others must succeed. */
async function windowOf(report: Scene6Report, name: string, targets: Address[], label: string, calls: Call[]): Promise<void> {
  const todo = calls.filter((call) => !done(report, call.id));
  if (todo.length === 0) return;
  for (const call of todo) {
    if (call.landed && (await call.landed())) {
      throw new Error(
        `"${call.title}" already happened on chain but its hash is not in ${SCENE6_REPORT}. ` +
          "Find it on the explorer, add the step and the transaction to the report by hand, and re-run. Nothing was sent.",
      );
    }
  }
  const opened = await withEvmWindow(
    name,
    { txs: todo.length, maxValueUqor: (WINDOW_CAP.call * BigInt(todo.length)).toString(), targets, blocks: 200 },
    async (account: UnifiedAccount) => {
      const out: { call: Call; hash: string; error?: string; note: string }[] = [];
      for (const call of todo) {
        if (call.expect) {
          const result = await refuse({ account, to: call.to, data: call.data, kind: "call", label: call.title });
          if (result.errorName !== call.expect) throw new Error(`${call.title} reverted ${result.errorName}, expected ${call.expect}`);
          out.push({ call, hash: result.hash, error: result.errorName, note: `${call.title} -> ${result.errorName}` });
        } else {
          const priced = await pricedCall({ from: getAddress(account.evm), to: call.to, data: call.data, kind: "call", label: call.title });
          const sent = await sendPriced({ account, to: call.to, data: call.data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: call.title });
          out.push({ call, hash: sent.hash, note: `${call.title} gasUsed ${sent.gasUsed} fee ${sent.uqor} uqor` });
        }
      }
      return out;
    },
  );
  report.transactions.push({ hash: opened.openHash, tier: "pqc", note: `${name} opens scoped window [${label}]` });
  for (const row of opened.result) {
    report.transactions.push({ hash: row.hash, tier: row.error ? "refused" : "classical", note: row.note });
    report.steps.push({
      id: row.call.id,
      title: row.call.title,
      outcome: row.error ? "refused" : (row.call.outcome ?? "held"),
      ...(row.error ? { error: row.error } : {}),
      hash: row.hash,
      who: row.call.who,
    });
    console.log(`${row.call.title}: ${row.error ?? "ok"} ${row.hash}`);
  }
  report.transactions.push({ hash: opened.closeHash, tier: "pqc", note: `${name} closes the [${label}] window` });
  save(report);
}

async function main(): Promise<void> {
  const report = load();
  if (report.ok) throw new Error("already ran");
  if (!BROADCAST && !existsSync("deployments/escrow-v2.json")) {
    await plan(report, undefined);
    stopUnlessBroadcast();
  }
  const { factory, escrow, timeout } = inputs();
  await plan(report, escrow);
  stopUnlessBroadcast();

  const [clientAcc, freelancerAcc, carolAcc] = await Promise.all([loadAccount(CLIENT), loadAccount(FREELANCER), loadAccount(COURIER_CAROL)]);
  const client = getAddress(clientAcc.evm);
  const freelancer = getAddress(freelancerAcc.evm);
  const carol = getAddress(carolAcc.evm);
  Object.assign(report, { escrowD: escrow, factory, deliveryReceipts: DELIVERY_RECEIPTS, client, freelancer, carol, arbiterTimeout: timeout.toString() });
  if (!report.freelancerBefore) report.freelancerBefore = (await fusdOf(freelancer)).toString();
  if (!report.clientBefore) report.clientBefore = (await fusdOf(client)).toString();
  save(report);

  const manifest = await seal(report, escrow);
  const commitment = report.commitment as Hex;
  const parts = report.parts as unknown as Parts;
  const conversationId = report.conversationId as Hex;
  const ciphertextHash = keccak256(manifest.ciphertext);

  // 1. Deliver, then acknowledge with no receipt at all.
  if (!done(report, "no-receipt") && (await storedReceipt(conversationId, COUNTER.client, commitment, client)) !== 0n) {
    throw new Error("the client's receipt already exists, so the no-receipt refusal can no longer be recorded");
  }
  const before = (await milestoneV2(escrow, M)).status;
  if (before !== Status.Funded && !done(report, "deliver")) {
    throw new Error(`milestone 0 is status ${before} but the deliver step is not in ${SCENE6_REPORT}; add its hash by hand. Nothing was sent.`);
  }
  const deliverCalls: Call[] = [];
  if (before === Status.Funded) {
    const deadline = await authDeadline();
    const sig = signDeliver(signerOf(freelancerAcc), { escrow, m: M, commitment, nonce: (await nonces(escrow)).freelancer, deadline });
    deliverCalls.push({ id: "deliver", title: "deliver(0), relayed by spike", who: "Freelancer, ML-DSA-87", to: escrow, data: deliverData(M, commitment, deadline, sig) });
  }
  deliverCalls.push({ id: "no-receipt", title: "acknowledge(0) with no receipt", who: "Anyone", to: escrow, data: acknowledgeData(M, conversationId, COUNTER.client, parts), expect: "NoReceipt" });
  await windowOf(report, SPIKE, [escrow], "D", deliverCalls);

  // 2. Carol: a receipt naming the client but signed by Carol's key, then Carol's own valid receipt.
  const forged = signCourierReceipt(carolAcc.pqc.secretKey, { conversationId, counter: COUNTER.client, ciphertextHash: commitment, recipient: client });
  const own = signCourierReceipt(carolAcc.pqc.secretKey, { conversationId, counter: COUNTER.carol, ciphertextHash: commitment, recipient: carol });
  await windowOf(report, COURIER_CAROL, [DELIVERY_RECEIPTS], "DeliveryReceipts", [
    { id: "forged-receipt", title: "record a receipt naming the client, signed by Carol's key", who: "Courier's Carol", to: DELIVERY_RECEIPTS, data: recordData(conversationId, COUNTER.client, commitment, client, forged), expect: "SignatureInvalid" },
    { id: "carol-receipt", title: "record Carol's own receipt over the commitment (counter 2)", who: "Courier's Carol, ML-DSA-87", to: DELIVERY_RECEIPTS, data: recordData(conversationId, COUNTER.carol, commitment, carol, own), landed: async () => (await storedReceipt(conversationId, COUNTER.carol, commitment, carol)) !== 0n },
  ]);

  // 3. The client's device opens the file and signs two receipts; then the client disputes and goes silent.
  if (!done(report, "client-receipt")) {
    const plain = openAsClient(manifest, loadSealKeys(CLIENT));
    if (new TextDecoder().decode(plain) !== FILE) throw new Error("the client could not open the sealed file");
    console.log("client opened the sealed file locally; plaintext hash matches the manifest");
  }
  const real = clientReceiptFor(manifest, client, COUNTER.client);
  if (real.ciphertextHash !== commitment || real.conversationId !== conversationId) throw new Error("receipt fields drifted");
  const ciphertextOnly = { conversationId, counter: COUNTER.ciphertextOnly, ciphertextHash, recipient: client };
  const clientCalls: Call[] = [
    { id: "ciphertext-receipt", title: "client records a receipt over keccak256(ciphertext) only (counter 1)", who: "Client, ML-DSA-87", to: DELIVERY_RECEIPTS, data: recordData(conversationId, COUNTER.ciphertextOnly, ciphertextHash, client, signCourierReceipt(clientAcc.pqc.secretKey, ciphertextOnly)), landed: async () => (await storedReceipt(conversationId, COUNTER.ciphertextOnly, ciphertextHash, client)) !== 0n },
    { id: "client-receipt", title: "client records the receipt over the commitment (counter 0)", who: "Client, ML-DSA-87", to: DELIVERY_RECEIPTS, data: recordData(conversationId, COUNTER.client, commitment, client, signCourierReceipt(clientAcc.pqc.secretKey, real)), landed: async () => (await storedReceipt(conversationId, COUNTER.client, commitment, client)) !== 0n },
  ];
  if (!done(report, "dispute")) {
    const deadline = (await authDeadline()) + 1800n;
    const sig = signDispute(signerOf(clientAcc), { escrow, m: M, byClient: true, nonce: (await nonces(escrow)).client, deadline });
    clientCalls.push({ id: "dispute", title: "client disputes milestone 0, then goes silent", who: "Client, ML-DSA-87", to: escrow, data: disputeData(M, true, deadline, sig), landed: async () => (await milestoneV2(escrow, M)).status === Status.Disputed });
  }
  await windowOf(report, CLIENT, [DELIVERY_RECEIPTS, escrow], "DeliveryReceipts, D", clientCalls);

  // 4. Too early for the silent panel; two wrong receipts refused; the client's receipt recorded on the escrow.
  const disputed = await milestoneV2(escrow, M);
  if (disputed.status !== Status.Disputed) throw new Error(`milestone 0 is status ${disputed.status}, expected Disputed`);
  if (!done(report, "timeout-early") && (await chainTime()) > disputed.disputedAt + timeout) {
    throw new Error("the arbiter timeout already passed, so the TooEarly refusal can no longer be recorded");
  }
  await windowOf(report, SPIKE, [escrow], "D", [
    { id: "timeout-early", title: "resolveTimeout(0) before the 180 s arbiter timeout", who: "Anyone", to: escrow, data: resolveTimeoutData(M), expect: "TooEarly" },
    { id: "carol-ack", title: "acknowledge(0) with Carol's receipt (counter 2)", who: "Anyone", to: escrow, data: acknowledgeData(M, conversationId, COUNTER.carol, parts), expect: "NoReceipt" },
    { id: "ciphertext-ack", title: "acknowledge(0) with the ciphertext-only receipt (counter 1)", who: "Anyone", to: escrow, data: acknowledgeData(M, conversationId, COUNTER.ciphertextOnly, parts), expect: "NoReceipt" },
    { id: "acknowledge", title: "acknowledge(0) with the client's receipt (counter 0), while Disputed", who: "Spike, no role", to: escrow, data: acknowledgeData(M, conversationId, COUNTER.client, parts), landed: async () => (await milestoneV2(escrow, M)).receivedAt !== 0n },
  ]);
  const received = await milestoneV2(escrow, M);
  if (received.receivedAt === 0n) throw new Error("acknowledge did not set receivedAt");
  report.receivedAt = received.receivedAt.toString();
  report.disputedAt = received.disputedAt.toString();
  report.recordedAt = (await storedReceipt(conversationId, COUNTER.client, commitment, client)).toString();
  save(report);

  // 5. No arbiter signs. After the timeout, resolveTimeout pays receivedSplitBps.
  const at = received.disputedAt + timeout;
  console.log(`waiting for chain timestamp > ${at}...`);
  while ((await milestoneV2(escrow, M)).status === Status.Disputed && (await chainTime()) <= at) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  await windowOf(report, SPIKE, [escrow], "D", [
    { id: "timeout-paid", title: "resolveTimeout(0): receivedSplitBps 10000, 100,000 fUSD base units to the freelancer", who: "Spike, no role", to: escrow, data: resolveTimeoutData(M), outcome: "paid", landed: async () => (await milestoneV2(escrow, M)).status === Status.Resolved },
  ]);
  if ((await milestoneV2(escrow, M)).status !== Status.Resolved) throw new Error("milestone 0 is not Resolved");
  const delta = (await fusdOf(freelancer)) - BigInt(report.freelancerBefore);
  const clientDelta = (await fusdOf(client)) - BigInt(report.clientBefore);
  if (delta !== 100_000n || clientDelta !== 0n) throw new Error(`freelancer +${delta}, client +${clientDelta}; expected +100000 and +0`);
  if ((await fusdOf(escrow)) !== 0n) throw new Error("escrow D still holds fUSD");

  report.freelancerDelta = delta.toString();
  report.clientDelta = clientDelta.toString();
  report.ok = true;
  report.ranAt = new Date().toISOString();
  save(report);
  writeJson(WEB_RECORD, webRecord(report));
  console.log(`Escrow D: the client disputed and went silent; the arbiters stayed silent; the client's own receipt was on record, so resolveTimeout paid ${delta} fUSD base units to ${freelancer}. Wrote ${WEB_RECORD}.`);
  console.log("Check with: npm run evidence; then (cd apps/web && npm run test:unit && npx playwright test)");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
