import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TOOLS, toolContext } from "@qorechain/mcp";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import { DELIVERY_RECEIPTS, DELIVERY_RECEIPTS_CODEHASH, escrowV2Abi, factoryV2Abi } from "../src/ts/receipt-gate.js";
import { evmClient } from "./lib/chain.js";
import { milestoneV2, storedReceipt } from "./lib/gate.js";
import { SCENE6_REPORT, type Scene6Report } from "./lib/gate-record.js";
import { printBalanceDelta } from "./lib/live.js";

/**
 * Re-checks every recorded testnet hash in `deployments/*.json` through `@qorechain/mcp`:
 * - `pqc`: hybrid-signed transaction, succeeded, and ML-DSA-87 layer verified.
 * - `enrollment`: classically signed ML-DSA registration.
 * - `classical`: EVM-lane transaction inside a window.
 * - `refused`: expected on-chain refusal (code != 0 or `execution_failures` present).
 *   An EVM revert is still a successful MsgEthereumTx on the native lane, so a
 *   refused 0x hash also needs its EVM receipt status to be `reverted`.
 */
type Tier = "pqc" | "enrollment" | "classical" | "refused";

type Entry = { hash: string; tier: Tier; note: string };
type DeploymentFile = { network: string; transactions: Entry[] };
type Row = { file: string; hash: string; tier: Tier; ok: boolean; detail: string; note: string };

type TransactionResult = { success: boolean; failure?: unknown; execution_failures?: unknown[] };
type PqStatusResult = {
  transaction_status: {
    tier: string;
    has_exactly_one_pqc_layer: boolean;
    verification: { checked: boolean; verified: boolean | null; reason: string | null };
  } | null;
};

function tool(name: string) {
  const found = TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`@qorechain/mcp has no ${name} tool`);
  return found;
}

const getTransaction = tool("get_transaction");
const getPqStatus = tool("get_pq_status");
const ctx = toolContext({ defaultNetwork: "testnet" });

async function check(file: string, entry: Entry): Promise<Row> {
  const row = { file, hash: entry.hash, tier: entry.tier, ok: false, detail: "", note: entry.note };
  try {
    const tx = (await getTransaction.handler({ network: "testnet", hash: entry.hash }, ctx)) as TransactionResult;
    const refused = (tx.execution_failures?.length ?? 0) > 0;
    if (entry.tier === "refused") {
      const detail = `success=${String(tx.success)} execFailures=${tx.execution_failures?.length ?? 0}`;
      if (tx.success === false || refused) return { ...row, ok: true, detail };
      if (!entry.hash.startsWith("0x")) return { ...row, ok: false, detail };
      const receipt = await evmClient().getTransactionReceipt({ hash: entry.hash as Hex });
      return { ...row, ok: receipt.status === "reverted", detail: `${detail} evm=${receipt.status}` };
    }
    const pq = (await getPqStatus.handler({ network: "testnet", target: entry.hash }, ctx)) as PqStatusResult;
    const status = pq.transaction_status;
    const parts = [`success=${String(tx.success)}`, `tier=${status?.tier ?? "?"}`];
    let ok = tx.success === true && !refused && status?.tier === entry.tier;
    if (entry.tier === "pqc") {
      const verified = status?.has_exactly_one_pqc_layer === true && status.verification.verified === true;
      parts.push(`ml-dsa=${String(verified)}`);
      ok = ok && verified;
    }
    return { ...row, ok, detail: parts.join(" ") };
  } catch (error) {
    return { ...row, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function checkEvidence(dir: string): Promise<Row[]> {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const rows: Row[] = [];
  for (const name of files) {
    const document = JSON.parse(readFileSync(join(dir, name), "utf8")) as DeploymentFile;
    if (document.network !== "qorechain-diana") throw new Error(`${name}: network ${document.network} is not the testnet`);
    for (const entry of document.transactions ?? []) rows.push(await check(name, entry));
  }
  return rows;
}

/**
 * HavenEscrowV2 state, read once its deployment files exist: the factory and Escrow D pin Courier's
 * DeliveryReceipts (whose code hash is the pinned Courier build), and, after scene 6, the client's stored receipt
 * over the stored commitment is on record and the silent-panel timeout resolved the milestone.
 */
export async function checkReceiptGate(dir: string): Promise<Row[]> {
  const deployPath = join(dir, "escrow-v2.json");
  if (!existsSync(deployPath)) return [];
  const rows: Row[] = [];
  const add = (note: string, ok: boolean, detail: string) =>
    rows.push({ file: "receipt gate", hash: "(state)", tier: "classical", ok, detail, note });
  try {
    const deploy = JSON.parse(readFileSync(deployPath, "utf8")) as { ok?: boolean; factory?: Address; escrowD?: Address };
    if (!deploy.ok || !deploy.factory || !deploy.escrowD) {
      add("escrow-v2.json is ok", false, "not ok yet");
      return rows;
    }
    const client = evmClient();
    const code = await client.getCode({ address: DELIVERY_RECEIPTS });
    const codehash = code ? keccak256(code) : "0x";
    add("DeliveryReceipts is the Courier build", codehash === DELIVERY_RECEIPTS_CODEHASH, `codehash ${codehash}`);
    const [factoryPin, escrowPin, marked] = await Promise.all([
      client.readContract({ address: deploy.factory, abi: factoryV2Abi, functionName: "receipts" }),
      client.readContract({ address: deploy.escrowD, abi: escrowV2Abi, functionName: "receipts" }),
      client.readContract({ address: deploy.factory, abi: factoryV2Abi, functionName: "isEscrow", args: [deploy.escrowD] }),
    ]);
    add("factory v2 and Escrow D pin DeliveryReceipts", getAddress(factoryPin) === DELIVERY_RECEIPTS && getAddress(escrowPin) === DELIVERY_RECEIPTS && marked,
      `factory ${factoryPin}, escrow ${escrowPin}, isEscrow ${String(marked)}`);
    const scenePath = join(dir, SCENE6_REPORT.split("/").pop() as string);
    if (!existsSync(scenePath)) return rows;
    const scene = JSON.parse(readFileSync(scenePath, "utf8")) as Scene6Report;
    if (!scene.ok || !scene.commitment || !scene.conversationId || !scene.client) {
      add("scene-6-receipt-gate.json is ok", false, "not ok yet");
      return rows;
    }
    const ms = await milestoneV2(deploy.escrowD, 0n);
    const recordedAt = await storedReceipt(scene.conversationId, 0n, scene.commitment, scene.client);
    const receivedSplit = await client.readContract({ address: deploy.escrowD, abi: escrowV2Abi, functionName: "receivedSplitBps" });
    add("Escrow D milestone 0 Resolved with the client's receipt on record", ms.status === 5 && ms.receivedAt.toString() === scene.receivedAt && Number(receivedSplit) === 10000,
      `status ${ms.status}, receivedAt ${ms.receivedAt}, receivedSplitBps ${receivedSplit}`);
    add("client's receipt over the stored commitment is on DeliveryReceipts", ms.commitment === scene.commitment && recordedAt > 0n && recordedAt.toString() === scene.recordedAt,
      `recordedAt ${recordedAt}`);
  } catch (error) {
    add("receipt gate reads", false, error instanceof Error ? error.message : String(error));
  }
  return rows;
}

function printTable(rows: Row[]): void {
  const header = ["result", "file", "tier", "hash", "detail", "note"];
  const lines = rows.map((row) => [row.ok ? "PASS" : "FAIL", row.file, row.tier, row.hash, row.detail, row.note]);
  const widths = header.map((_, i) => Math.max(header[i].length, ...lines.map((line) => line[i].length)));
  const format = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  console.log(format(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const line of lines) console.log(format(line));
}

const dir = process.argv[2] ?? "deployments";
Promise.all([checkEvidence(dir), checkReceiptGate(dir)])
  .then(async ([hashes, gate]) => {
    const rows = [...hashes, ...gate];
    if (rows.length === 0) {
      console.error(`no transactions recorded in ${dir}`);
      process.exit(1);
    }
    printTable(rows);
    const failed = rows.filter((row) => !row.ok).length;
    console.log(`\n${rows.length - failed} passed, ${failed} failed`);
    await printBalanceDelta();
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
