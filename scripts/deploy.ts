/**
 * Deploys EscrowFactory from spike in an unscoped window, then creates escrow A
 * and escrow B through factory.create. Both creates share one window scoped to
 * the factory when neither exists yet. A finished report throws "already ran".
 */
import { readFileSync } from "node:fs";
import { decodeEventLog, encodeDeployData, encodeFunctionData, getAddress, type Abi, type Address, type Hex } from "viem";
import { escrowAbi, factoryAbi } from "../src/ts/escrow.js";
import { evmClient, pricedCall, sendPriced, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";
import {
  ARBITER_NAMES,
  CLIENT,
  DAY,
  FREELANCER,
  FUSD,
  SPIKE,
  Status,
  assertSealKey,
  chainTime,
  milestone,
  party,
  snapshotBalances,
  sortedArbiters,
  writeJson,
  type Tx,
} from "./lib/live.js";

const REPORT = "deployments/escrow.json";

type Terms = {
  client: Address;
  freelancer: Address;
  token: Address;
  arbiters: Address[];
  reviewPeriod: bigint;
  arbiterTimeout: bigint;
  defaultSplitBps: number;
  amounts: bigint[];
  deadlines: bigint[];
};

type StoredTerms = {
  client: Address;
  freelancer: Address;
  token: Address;
  arbiters: Address[];
  reviewPeriod: string;
  arbiterTimeout: string;
  defaultSplitBps: number;
  amounts: string[];
  deadlines: string[];
};

type Report = {
  network: string;
  ranAt?: string;
  ok: boolean;
  factory?: Address;
  deployer?: Address;
  escrowA?: Address;
  escrowB?: Address;
  termsA?: StoredTerms;
  termsB?: StoredTerms;
  arbiters?: { name: string; evm: Address }[];
  transactions: Tx[];
};

function load(): Report {
  try {
    return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
  } catch {
    return { network: "qorechain-diana", ok: false, transactions: [] };
  }
}

function save(report: Report): void {
  writeJson(REPORT, report);
}

function storeTerms(terms: Terms): StoredTerms {
  return {
    client: terms.client,
    freelancer: terms.freelancer,
    token: terms.token,
    arbiters: terms.arbiters,
    reviewPeriod: terms.reviewPeriod.toString(),
    arbiterTimeout: terms.arbiterTimeout.toString(),
    defaultSplitBps: terms.defaultSplitBps,
    amounts: terms.amounts.map((amount) => amount.toString()),
    deadlines: terms.deadlines.map((deadline) => deadline.toString()),
  };
}

function parseTerms(stored: StoredTerms): Terms {
  return {
    ...stored,
    reviewPeriod: BigInt(stored.reviewPeriod),
    arbiterTimeout: BigInt(stored.arbiterTimeout),
    amounts: stored.amounts.map((amount) => BigInt(amount)),
    deadlines: stored.deadlines.map((deadline) => BigInt(deadline)),
  };
}

function createdFromReceipt(factory: Address, logs: { address: Address; data: Hex; topics: [] | [Hex, ...Hex[]] }[]): Address {
  for (const log of logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "EscrowCreated") return getAddress(decoded.args.escrow);
    } catch {
      /* a log from the new escrow, not the factory event */
    }
  }
  throw new Error("EscrowCreated was not in the receipt");
}

async function deployFactory(report: Report): Promise<Address> {
  if (report.factory) {
    const code = await evmClient().getCode({ address: report.factory });
    if (!code || code === "0x") throw new Error(`factory ${report.factory} has no code`);
    return report.factory;
  }
  const artifact = JSON.parse(readFileSync("out/EscrowFactory.sol/EscrowFactory.json", "utf8")) as {
    abi: Abi;
    bytecode: { object: Hex };
  };
  const deployData = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object });
  const opened = await withEvmWindow(
    SPIKE,
    { txs: 1, maxValueUqor: WINDOW_CAP.deploy.toString(), blocks: 200 },
    async (account) => {
      const priced = await pricedCall({
        from: getAddress(account.evm),
        data: deployData,
        kind: "deploy",
        label: "factory deploy",
      });
      const sent = await sendPriced({
        account,
        data: deployData,
        gas: priced.gas,
        gasPrice: priced.gasPrice,
        kind: "deploy",
        label: "factory deploy",
      });
      const receipt = await evmClient().getTransactionReceipt({ hash: sent.hash });
      if (!receipt.contractAddress) throw new Error(`factory deploy ${sent.hash} has no contract address`);
      return { hash: sent.hash, gasUsed: sent.gasUsed, uqor: sent.uqor, budget: priced.budget, address: getAddress(receipt.contractAddress) };
    },
  );
  const code = await evmClient().getCode({ address: opened.result.address });
  if (!code || code === "0x") throw new Error(`no code at ${opened.result.address}`);
  report.factory = opened.result.address;
  report.deployer = (await party(SPIKE)).evm;
  report.transactions.push(
    { hash: opened.openHash, tier: "pqc", note: "open unscoped factory deploy window" },
    {
      hash: opened.result.hash,
      tier: "classical",
      note: `deploy EscrowFactory gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor budget ${opened.result.budget}`,
    },
    { hash: opened.closeHash, tier: "pqc", note: "close factory deploy window" },
  );
  save(report);
  console.log(`factory ${report.factory}`);
  return report.factory;
}

async function createMissing(factory: Address, report: Report, termsA: Terms, termsB: Terms): Promise<void> {
  const jobs: { key: "escrowA" | "escrowB"; terms: Terms; label: string }[] = [];
  if (!report.escrowA) jobs.push({ key: "escrowA", terms: termsA, label: "create escrow A" });
  if (!report.escrowB) jobs.push({ key: "escrowB", terms: termsB, label: "create escrow B" });
  if (jobs.length === 0) return;
  const opened = await withEvmWindow(
    SPIKE,
    { txs: jobs.length, maxValueUqor: (WINDOW_CAP.call * BigInt(jobs.length)).toString(), targets: [factory], blocks: 200 },
    async (account) => {
      const created: { key: "escrowA" | "escrowB"; address: Address; hash: Hex; gasUsed: bigint; uqor: bigint }[] = [];
      for (const job of jobs) {
        const data = encodeFunctionData({ abi: factoryAbi, functionName: "create", args: [job.terms] });
        const priced = await pricedCall({
          from: getAddress(account.evm),
          to: factory,
          data,
          kind: "call",
          label: job.label,
        });
        const sent = await sendPriced({
          account,
          to: factory,
          data,
          gas: priced.gas,
          gasPrice: priced.gasPrice,
          kind: "call",
          label: job.label,
        });
        const receipt = await evmClient().getTransactionReceipt({ hash: sent.hash });
        const address = createdFromReceipt(factory, receipt.logs);
        const marked = await evmClient().readContract({
          address: factory,
          abi: factoryAbi,
          functionName: "isEscrow",
          args: [address],
        });
        if (!marked) throw new Error(`${address} is not marked by the factory`);
        created.push({ key: job.key, address, hash: sent.hash, gasUsed: sent.gasUsed, uqor: sent.uqor });
      }
      return created;
    },
  );
  report.transactions.push({
    hash: opened.openHash,
    tier: "pqc",
    note: `open scoped window [factory] for ${jobs.map((job) => job.label).join(", ")}`,
  });
  for (const row of opened.result) {
    report[row.key] = row.address;
    report.transactions.push({
      hash: row.hash,
      tier: "classical",
      note: `${row.key === "escrowA" ? "create escrow A" : "create escrow B"} gasUsed ${row.gasUsed} fee ${row.uqor} uqor`,
    });
    console.log(`${row.key} ${row.address}`);
  }
  report.transactions.push({ hash: opened.closeHash, tier: "pqc", note: "close factory create window" });
  save(report);
}

async function verify(escrow: Address, terms: Terms): Promise<void> {
  const client = evmClient();
  const read = <T extends "client" | "freelancer" | "token" | "reviewPeriod" | "arbiterTimeout" | "defaultSplitBps" | "milestoneCount" | "arbiters">(
    functionName: T,
  ) => client.readContract({ address: escrow, abi: escrowAbi, functionName });
  const [clientAddr, freelancer, token, review, timeout, split, count, arbiters] = await Promise.all([
    read("client"),
    read("freelancer"),
    read("token"),
    read("reviewPeriod"),
    read("arbiterTimeout"),
    read("defaultSplitBps"),
    read("milestoneCount"),
    read("arbiters"),
  ]);
  const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
  if (!same(clientAddr, terms.client)) throw new Error(`${escrow} client ${clientAddr}`);
  if (!same(freelancer, terms.freelancer)) throw new Error(`${escrow} freelancer ${freelancer}`);
  if (!same(token, terms.token)) throw new Error(`${escrow} token ${token}`);
  if (review !== terms.reviewPeriod) throw new Error(`${escrow} reviewPeriod ${review}`);
  if (timeout !== terms.arbiterTimeout) throw new Error(`${escrow} arbiterTimeout ${timeout}`);
  if (Number(split) !== terms.defaultSplitBps) throw new Error(`${escrow} defaultSplitBps ${split}`);
  if (count !== BigInt(terms.amounts.length)) throw new Error(`${escrow} milestoneCount ${count}`);
  if (arbiters.length !== terms.arbiters.length) throw new Error(`${escrow} arbiter count ${arbiters.length}`);
  for (let i = 0; i < terms.arbiters.length; i++) {
    if (!same(arbiters[i], terms.arbiters[i])) throw new Error(`${escrow} arbiter ${i} is ${arbiters[i]}`);
  }
  for (let m = 0; m < terms.amounts.length; m++) {
    const row = await milestone(escrow, BigInt(m));
    if (row.amount !== terms.amounts[m]) throw new Error(`${escrow} m${m} amount ${row.amount}`);
    if (row.deadline !== terms.deadlines[m]) throw new Error(`${escrow} m${m} deadline ${row.deadline}`);
    if (row.status !== Status.Unfunded) throw new Error(`${escrow} m${m} status ${row.status}`);
  }
}

async function main(): Promise<void> {
  const report = load();
  if (report.ok) throw new Error("already ran");
  await snapshotBalances();
  for (const name of [CLIENT, ...ARBITER_NAMES]) await assertSealKey(name);

  const factory = await deployFactory(report);
  if (!report.termsA || !report.termsB) {
    const [client, freelancer, arbiters] = await Promise.all([party(CLIENT), party(FREELANCER), sortedArbiters()]);
    const now = await chainTime();
    const shared = {
      client: client.evm,
      freelancer: freelancer.evm,
      token: FUSD,
      arbiters: arbiters.map((who) => who.evm),
      arbiterTimeout: 3n * DAY,
      defaultSplitBps: 5000,
    };
    report.termsA = storeTerms({ ...shared, reviewPeriod: DAY, amounts: [1_000_000n, 1_000_000n], deadlines: [now + 2n * DAY, now + 2n * DAY] });
    report.termsB = storeTerms({ ...shared, reviewPeriod: 120n, amounts: [1_000_000n], deadlines: [now + DAY] });
    report.arbiters = arbiters.map((who) => ({ name: who.name, evm: who.evm }));
    save(report);
  }
  const termsA = parseTerms(report.termsA);
  const termsB = parseTerms(report.termsB);
  await createMissing(factory, report, termsA, termsB);
  if (!report.escrowA || !report.escrowB) throw new Error("create did not record both escrows");
  await verify(report.escrowA, termsA);
  await verify(report.escrowB, termsB);
  report.ok = true;
  report.ranAt = new Date().toISOString();
  save(report);
  console.log(`factory ${factory}`);
  console.log(`escrow A ${report.escrowA}`);
  console.log(`escrow B ${report.escrowB}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
