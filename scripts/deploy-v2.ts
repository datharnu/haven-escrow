/**
 * Receipt evidence, part 1. Deploys EscrowFactoryV2 pinned to Courier's live DeliveryReceipts, creates Escrow D
 * (one 100,000 fUSD base unit milestone, 1-day review, 180 s arbiter timeout, defaultSplitBps 5000,
 * receivedSplitBps 10000), and funds it.
 *
 *   forge build                     # the artifact this script deploys comes from out/
 *   npm run deploy:v2               # plan only: reads the chain, prints every step and its cost, sends nothing
 *   npm run deploy:v2 -- --broadcast
 *
 * Spike deploys the factory (unscoped window: a scoped window cannot create a contract from an EOA).
 * The client creates and funds Escrow D in windows scoped to the factory and to the escrow.
 * The report is deployments/escrow-v2.json; once it says ok, the script throws "already ran".
 */
import { existsSync, readFileSync } from "node:fs";
import { decodeEventLog, encodeDeployData, encodeFunctionData, getAddress, type Abi, type Address, type Hex } from "viem";
import { DELIVERY_RECEIPTS, escrowV2Abi, factoryV2Abi } from "../src/ts/receipt-gate.js";
import { evmClient, pricedCall, sendPriced, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";
import {
  ARBITER_NAMES,
  CLIENT,
  DAY,
  FREELANCER,
  FUSD,
  SPIKE,
  Status,
  bankFusd,
  chainTime,
  fundData,
  fusdOf,
  party,
  sortedArbiters,
  writeJson,
  type Tx,
} from "./lib/live.js";
import {
  COST,
  accountRows,
  checkDeliveryReceipts,
  convertFusd,
  milestoneV2,
  printPlan,
  qor,
  stopUnlessBroadcast,
} from "./lib/gate.js";

const REPORT = "deployments/escrow-v2.json";
const AMOUNT = 100_000n;
const REVIEW = DAY;
/** Short so scene 6 can wait for the silent panel in real time. */
const ARBITER_TIMEOUT = 180n;
const DEFAULT_SPLIT = 5000;
/** A silent panel pays the freelancer in full once the client's receipt is on record. */
const RECEIVED_SPLIT = 10000;

type StoredTerms = {
  client: Address;
  freelancer: Address;
  token: Address;
  arbiters: Address[];
  reviewPeriod: string;
  arbiterTimeout: string;
  defaultSplitBps: number;
  receivedSplitBps: number;
  amounts: string[];
  deadlines: string[];
};

type Report = {
  network: string;
  ranAt?: string;
  ok: boolean;
  factory?: Address;
  deliveryReceipts: Address;
  deliveryReceiptsCodehash?: Hex;
  escrowD?: Address;
  termsD?: StoredTerms;
  transactions: Tx[];
};

function load(): Report {
  if (!existsSync(REPORT)) return { network: "qorechain-diana", ok: false, deliveryReceipts: DELIVERY_RECEIPTS, transactions: [] };
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function parseTerms(t: StoredTerms) {
  return {
    ...t,
    reviewPeriod: BigInt(t.reviewPeriod),
    arbiterTimeout: BigInt(t.arbiterTimeout),
    amounts: t.amounts.map(BigInt),
    deadlines: t.deadlines.map(BigInt),
  };
}

function createdFrom(factory: Address, logs: { address: Address; data: Hex; topics: [] | [Hex, ...Hex[]] }[]): Address {
  for (const log of logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: factoryV2Abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "EscrowCreated") return getAddress(decoded.args.escrow);
    } catch {
      /* a log from the new escrow */
    }
  }
  throw new Error("EscrowCreated was not in the receipt");
}

async function plan(report: Report): Promise<void> {
  const dr = await checkDeliveryReceipts();
  const rows = await accountRows([SPIKE, CLIENT, FREELANCER, ...ARBITER_NAMES]);
  const client = rows.find((row) => row.name === CLIENT)!;
  const [bank, evm] = await Promise.all([bankFusd(client.cosmos), fusdOf(client.evm)]);
  console.log(`chain id ${await evmClient().getChainId()}, block ${await evmClient().getBlockNumber()}`);
  console.log(`DeliveryReceipts ${DELIVERY_RECEIPTS} code hash ${dr.codehash} ${dr.ok ? "matches" : "DOES NOT MATCH"} the Courier build`);
  console.log(`client fUSD: bank ${bank}, EVM ${evm}; Escrow D needs ${AMOUNT}`);
  const steps: string[] = [];
  const spend: Record<string, bigint> = {};
  const add = (name: string, uqor: bigint) => (spend[name] = (spend[name] ?? 0n) + uqor);
  if (!report.factory) {
    steps.push(`spike: open unscoped window, deploy EscrowFactoryV2(${DELIVERY_RECEIPTS}) (~2.9M gas), close`);
    add(SPIKE, COST.windowOpenClose + 330_000n);
  }
  if (!report.escrowD) {
    steps.push("client: window [factoryV2], create Escrow D (1 milestone, 100,000 fUSD base units, review 1 day, arbiter timeout 180 s, defaultSplitBps 5000, receivedSplitBps 10000, deadline now + 7 days)");
    add(CLIENT, COST.windowOpenClose + 260_000n);
  }
  steps.push(`client: MsgConvertCoin ${AMOUNT} fUSD base units from the bank straight to Escrow D (hybrid PQC signed)`);
  add(CLIENT, COST.convert);
  steps.push("client: window [Escrow D], fund()");
  add(CLIENT, COST.windowOpenClose + 10_000n);
  steps.push("read back: factory.receipts(), escrow.receipts(), parties, arbiters, review, arbiter timeout, both splits, milestone 0 Funded");
  printPlan("Receipt gate: deploy EscrowFactoryV2 and Escrow D", steps, spend, rows);
  if (!dr.ok) throw new Error("DeliveryReceipts code does not match the pinned hash. Not deploying.");
  for (const row of rows) if (!row.mlDsa87) throw new Error(`${row.name} has no proven ML-DSA-87 key on chain`);
  if (!report.escrowD && bank < AMOUNT) throw new Error(`client bank holds ${bank} fUSD base units, below ${AMOUNT}`);
  for (const row of rows) {
    if ((spend[row.name] ?? 0n) > row.uqor) throw new Error(`${row.name} has ${qor(row.uqor)}, below the estimate`);
  }
}

async function deployFactory(report: Report): Promise<Address> {
  if (report.factory) return report.factory;
  const artifact = JSON.parse(readFileSync("out/EscrowFactoryV2.sol/EscrowFactoryV2.json", "utf8")) as {
    abi: Abi;
    bytecode: { object: Hex };
  };
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [DELIVERY_RECEIPTS] });
  const opened = await withEvmWindow(SPIKE, { txs: 1, maxValueUqor: WINDOW_CAP.deploy.toString(), blocks: 200 }, async (account) => {
    const priced = await pricedCall({ from: getAddress(account.evm), data, kind: "deploy", label: "factory v2 deploy" });
    const sent = await sendPriced({ account, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "deploy", label: "factory v2 deploy" });
    const receipt = await evmClient().getTransactionReceipt({ hash: sent.hash });
    if (!receipt.contractAddress) throw new Error(`factory v2 deploy ${sent.hash} has no contract address`);
    return { ...sent, address: getAddress(receipt.contractAddress) };
  });
  const pinned = await evmClient().readContract({ address: opened.result.address, abi: factoryV2Abi, functionName: "receipts" });
  if (getAddress(pinned) !== DELIVERY_RECEIPTS) throw new Error(`factory v2 pins ${pinned}`);
  report.factory = opened.result.address;
  report.transactions.push(
    { hash: opened.openHash, tier: "pqc", note: "spike opens unscoped window for EscrowFactoryV2 deploy" },
    { hash: opened.result.hash, tier: "classical", note: `deploy EscrowFactoryV2(${DELIVERY_RECEIPTS}) gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
    { hash: opened.closeHash, tier: "pqc", note: "spike closes factory v2 deploy window" },
  );
  writeJson(REPORT, report);
  console.log(`factory v2 ${report.factory}`);
  return report.factory;
}

async function createEscrow(report: Report, factory: Address): Promise<Address> {
  if (report.escrowD) return report.escrowD;
  if (!report.termsD) {
    const [client, freelancer, arbiters] = await Promise.all([party(CLIENT), party(FREELANCER), sortedArbiters()]);
    const now = await chainTime();
    report.termsD = {
      client: client.evm,
      freelancer: freelancer.evm,
      token: FUSD,
      arbiters: arbiters.map((who) => who.evm),
      reviewPeriod: REVIEW.toString(),
      arbiterTimeout: ARBITER_TIMEOUT.toString(),
      defaultSplitBps: DEFAULT_SPLIT,
      receivedSplitBps: RECEIVED_SPLIT,
      amounts: [AMOUNT.toString()],
      deadlines: [(now + 7n * DAY).toString()],
    };
    writeJson(REPORT, report);
  }
  const data = encodeFunctionData({ abi: factoryV2Abi, functionName: "create", args: [parseTerms(report.termsD)] });
  const opened = await withEvmWindow(
    CLIENT,
    { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [factory], blocks: 200 },
    async (account) => {
      const priced = await pricedCall({ from: getAddress(account.evm), to: factory, data, kind: "call", label: "create escrow D" });
      const sent = await sendPriced({ account, to: factory, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "create escrow D" });
      const receipt = await evmClient().getTransactionReceipt({ hash: sent.hash });
      return { ...sent, escrow: createdFrom(factory, receipt.logs) };
    },
  );
  report.escrowD = opened.result.escrow;
  report.transactions.push(
    { hash: opened.openHash, tier: "pqc", note: "client opens scoped window [factoryV2] for create escrow D" },
    { hash: opened.result.hash, tier: "classical", note: `create escrow D (${report.escrowD}) gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
    { hash: opened.closeHash, tier: "pqc", note: "client closes create escrow D window" },
  );
  writeJson(REPORT, report);
  console.log(`escrow D ${report.escrowD}`);
  return report.escrowD;
}

async function fund(report: Report, escrow: Address): Promise<void> {
  const have = await fusdOf(escrow);
  if (have < AMOUNT && (await milestoneV2(escrow, 0n)).status === Status.Unfunded) {
    const need = AMOUNT - have;
    const client = await party(CLIENT);
    if ((await bankFusd(client.cosmos)) < need) throw new Error(`client bank fUSD is below ${need}; top it up first`);
    const hash = await convertFusd(CLIENT, escrow, need);
    report.transactions.push({ hash, tier: "pqc", note: `MsgConvertCoin ${need} fUSD base units to escrow D` });
    writeJson(REPORT, report);
    console.log(`converted ${need} fUSD to escrow D: ${hash}`);
  }
  if ((await milestoneV2(escrow, 0n)).status !== Status.Unfunded) return;
  const data = fundData();
  const opened = await withEvmWindow(
    CLIENT,
    { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrow], blocks: 200 },
    async (account) => {
      const priced = await pricedCall({ from: getAddress(account.evm), to: escrow, data, kind: "call", label: "fund D" });
      return sendPriced({ account, to: escrow, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "fund D" });
    },
  );
  report.transactions.push(
    { hash: opened.openHash, tier: "pqc", note: "client opens scoped window [D] for fund()" },
    { hash: opened.result.hash, tier: "classical", note: `fund D gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
    { hash: opened.closeHash, tier: "pqc", note: "client closes fund D window" },
  );
  writeJson(REPORT, report);
  console.log(`funded D: ${opened.result.hash}`);
}

async function verify(report: Report, factory: Address, escrow: Address): Promise<void> {
  const read = <T extends "client" | "freelancer" | "receipts" | "reviewPeriod" | "arbiterTimeout" | "defaultSplitBps" | "receivedSplitBps" | "arbiters">(
    functionName: T,
  ) => evmClient().readContract({ address: escrow, abi: escrowV2Abi, functionName });
  const terms = parseTerms(report.termsD!);
  const [client, freelancer, receipts, review, timeout, split, receivedSplit, arbiters, marked] = await Promise.all([
    read("client"),
    read("freelancer"),
    read("receipts"),
    read("reviewPeriod"),
    read("arbiterTimeout"),
    read("defaultSplitBps"),
    read("receivedSplitBps"),
    read("arbiters"),
    evmClient().readContract({ address: factory, abi: factoryV2Abi, functionName: "isEscrow", args: [escrow] }),
  ]);
  if (!marked) throw new Error(`${escrow} is not marked by factory v2`);
  if (getAddress(client) !== terms.client || getAddress(freelancer) !== terms.freelancer) throw new Error("parties differ");
  if (getAddress(receipts) !== DELIVERY_RECEIPTS) throw new Error(`escrow D reads ${receipts}`);
  if (review !== terms.reviewPeriod) throw new Error(`review ${review}`);
  if (timeout !== terms.arbiterTimeout) throw new Error(`arbiterTimeout ${timeout}`);
  if (Number(split) !== terms.defaultSplitBps || Number(receivedSplit) !== terms.receivedSplitBps) {
    throw new Error(`splits ${split} / ${receivedSplit}`);
  }
  if (arbiters.map((a) => getAddress(a)).join() !== terms.arbiters.map((a) => getAddress(a)).join()) throw new Error("arbiters differ");
  const row = await milestoneV2(escrow, 0n);
  if (row.status !== Status.Funded || row.amount !== AMOUNT) throw new Error(`milestone 0 status ${row.status} amount ${row.amount}`);
}

async function main(): Promise<void> {
  const report = load();
  if (report.ok) throw new Error("already ran");
  await plan(report);
  stopUnlessBroadcast();
  const dr = await checkDeliveryReceipts();
  report.deliveryReceiptsCodehash = dr.codehash;
  const factory = await deployFactory(report);
  const escrow = await createEscrow(report, factory);
  await fund(report, escrow);
  await verify(report, factory, escrow);
  report.ok = true;
  report.ranAt = new Date().toISOString();
  writeJson(REPORT, report);
  console.log(`factory v2 ${factory}\nescrow D ${escrow} funded with ${AMOUNT} fUSD base units`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
