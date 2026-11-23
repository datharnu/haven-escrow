/**
 * Scene 5. Create Escrow C (0.1 fUSD, 60s arbiterTimeout, 5000 bps default split),
 * fund, deliver, dispute with client's ML-DSA-87 signature, refuse resolveTimeout
 * before the 60s timeout (TooEarly), wait for the real chain clock to pass, then
 * call resolveTimeout(0) from spike so the 50/50 split pays both named parties.
 */
import { readFileSync } from "node:fs";
import { BinaryWriter } from "cosmjs-types/binary";
import { qorechainRegistry } from "@qorechain/sdk";
import {
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { escrowAbi, factoryAbi, signDeliver, signDispute } from "../src/ts/escrow.js";
import { broadcast, evmClient, loadAccount, pricedCall, sendPriced, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";
import {
  CLIENT,
  DAY,
  FREELANCER,
  FUSD,
  FUSD_DENOM,
  Status,
  authDeadline,
  bankFusd,
  chainTime,
  deliverData,
  disputeData,
  fundData,
  fusdOf,
  milestone,
  nonces,
  party,
  printBalanceDelta,
  refuse,
  signerOf,
  sortedArbiters,
  writeJson,
  type Tx,
} from "./lib/live.js";

const REPORT = "deployments/scene-5-resolve-timeout.json";
const AMOUNT = 100_000n;
const ARBITER_TIMEOUT = 60n;
const CONVERT = "/cosmos.evm.erc20.v1.MsgConvertCoin";
const erc20TransferAbi = parseAbi(["function transfer(address to, uint256 value) returns (bool)"]);

const ConvertCoin = {
  typeUrl: CONVERT,
  fromPartial(value: { coin?: { denom?: string; amount?: string }; receiver?: string; sender?: string }) {
    return {
      coin: { denom: value.coin?.denom ?? "", amount: value.coin?.amount ?? "0" },
      receiver: value.receiver ?? "",
      sender: value.sender ?? "",
    };
  },
  encode(
    message: { coin: { denom: string; amount: string }; receiver: string; sender: string },
    writer = new BinaryWriter(),
  ) {
    const coin = new BinaryWriter();
    coin.uint32(10).string(message.coin.denom);
    coin.uint32(18).string(message.coin.amount);
    writer.uint32(10).bytes(coin.finish());
    writer.uint32(18).string(message.receiver);
    writer.uint32(26).string(message.sender);
    return writer;
  },
  decode() {
    throw new Error("decode is unused");
  },
};

type Report = {
  network: string;
  ranAt?: string;
  ok: boolean;
  escrowC?: Address;
  amount: string;
  arbiterTimeout: string;
  defaultSplitBps: number;
  clientBefore?: string;
  freelancerBefore?: string;
  clientDelta?: string;
  freelancerDelta?: string;
  transactions: Tx[];
};

function load(): Report {
  try {
    return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
  } catch {
    return {
      network: "qorechain-diana",
      ok: false,
      amount: AMOUNT.toString(),
      arbiterTimeout: ARBITER_TIMEOUT.toString(),
      defaultSplitBps: 5000,
      transactions: [],
    };
  }
}

function factoryAddress(): Address {
  const doc = JSON.parse(readFileSync("deployments/escrow.json", "utf8")) as { ok?: boolean; factory?: Address };
  if (!doc.ok || !doc.factory) throw new Error("deployments/escrow.json is not ok");
  return getAddress(doc.factory);
}

function createdFromReceipt(
  factory: Address,
  logs: { address: Address; data: Hex; topics: [] | [Hex, ...Hex[]] }[],
): Address {
  for (const log of logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "EscrowCreated") return getAddress(decoded.args.escrow);
    } catch {
      /* ignore logs from child contract */
    }
  }
  throw new Error("EscrowCreated was not in the receipt");
}

function resolveTimeoutData(m: bigint): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "resolveTimeout", args: [m] });
}

async function main(): Promise<void> {
  const report = load();
  if (report.ok) throw new Error("already ran");

  const factory = factoryAddress();
  const [clientAcc, freelancerAcc, arbiters] = await Promise.all([
    loadAccount(CLIENT),
    loadAccount(FREELANCER),
    sortedArbiters(),
  ]);
  const clientEvm = getAddress(clientAcc.evm);
  const freelancerEvm = getAddress(freelancerAcc.evm);

  // 1. Create Escrow C via EscrowFactory inside a scoped [factory] window.
  if (!report.escrowC) {
    const now = await chainTime();
    const terms = {
      client: clientEvm,
      freelancer: freelancerEvm,
      token: FUSD,
      arbiters: arbiters.map((a) => a.evm),
      reviewPeriod: 300n,
      arbiterTimeout: ARBITER_TIMEOUT,
      defaultSplitBps: 5000,
      amounts: [AMOUNT],
      deadlines: [now + DAY],
    };
    const data = encodeFunctionData({ abi: factoryAbi, functionName: "create", args: [terms] });
    const opened = await withEvmWindow(
      CLIENT,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [factory], blocks: 200 },
      async (account) => {
        const priced = await pricedCall({ from: getAddress(account.evm), to: factory, data, kind: "call", label: "create escrow C" });
        const sent = await sendPriced({ account, to: factory, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "create escrow C" });
        const receipt = await evmClient().getTransactionReceipt({ hash: sent.hash });
        return { ...sent, escrow: createdFromReceipt(factory, receipt.logs) };
      },
    );
    report.escrowC = opened.result.escrow;
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "client opens scoped window [factory] for create escrow C" },
      { hash: opened.result.hash, tier: "classical", note: `create escrow C (${opened.result.escrow}) gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
      { hash: opened.closeHash, tier: "pqc", note: "client closes create escrow C window" },
    );
    writeJson(REPORT, report);
    console.log(`escrow C ${report.escrowC}`);
  }

  const escrowC = report.escrowC;

  // 2. Transfer 100,000 fUSD base units into Escrow C and call fund().
  if ((await fusdOf(escrowC)) < AMOUNT) {
    const need = AMOUNT - (await fusdOf(escrowC));
    const bank = await bankFusd(clientAcc.cosmos);
    if (bank >= need) {
      const converted = await broadcast(
        clientAcc,
        [{ typeUrl: CONVERT, value: { coin: { denom: FUSD_DENOM, amount: need.toString() }, receiver: escrowC, sender: clientAcc.cosmos } }],
        "hybrid",
        qorechainRegistry([[CONVERT, ConvertCoin]]),
      );
      report.transactions.push({ hash: converted, tier: "pqc", note: `MsgConvertCoin ${need} fUSD base units to escrow C` });
      writeJson(REPORT, report);
      console.log(`converted ${need} fUSD to escrow C: ${converted}`);
    } else {
      const evmBal = await fusdOf(clientEvm);
      if (evmBal < need) throw new Error(`client has bank=${bank} evm=${evmBal}, need ${need} fUSD base units`);
      const data = encodeFunctionData({ abi: erc20TransferAbi, functionName: "transfer", args: [escrowC, need] });
      const opened = await withEvmWindow(
        CLIENT,
        { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [FUSD], blocks: 200 },
        async (account) => {
          const priced = await pricedCall({ from: getAddress(account.evm), to: FUSD, data, kind: "call", label: "transfer fUSD to C" });
          return sendPriced({ account, to: FUSD, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "transfer fUSD to C" });
        },
      );
      report.transactions.push(
        { hash: opened.openHash, tier: "pqc", note: "client opens scoped window [fUSD] to fund escrow C" },
        { hash: opened.result.hash, tier: "classical", note: `transfer ${need} fUSD to escrow C gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
        { hash: opened.closeHash, tier: "pqc", note: "client closes fUSD transfer window" },
      );
      writeJson(REPORT, report);
      console.log(`transferred ${need} fUSD to escrow C: ${opened.result.hash}`);
    }
  }

  if ((await milestone(escrowC, 0n)).status === Status.Unfunded) {
    const data = fundData();
    const opened = await withEvmWindow(
      CLIENT,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowC], blocks: 200 },
      async (account) => {
        const priced = await pricedCall({ from: getAddress(account.evm), to: escrowC, data, kind: "call", label: "fund C" });
        return sendPriced({ account, to: escrowC, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "fund C" });
      },
    );
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "client opens scoped window [C] for fund()" },
      { hash: opened.result.hash, tier: "classical", note: `fund C gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
      { hash: opened.closeHash, tier: "pqc", note: "client closes fund C window" },
    );
    writeJson(REPORT, report);
    console.log(`funded C: ${opened.result.hash}`);
  }

  // Record fUSD balances after funding, before settlement.
  if (!report.clientBefore || !report.freelancerBefore) {
    report.clientBefore = (await fusdOf(clientEvm)).toString();
    report.freelancerBefore = (await fusdOf(freelancerEvm)).toString();
    writeJson(REPORT, report);
  }

  // 3. Deliver milestone 0 (freelancer ML-DSA-87 signature, submitted by client).
  if ((await milestone(escrowC, 0n)).status === Status.Funded) {
    const commitment = keccak256(toBytes(`haven-escrow.scene-5-resolve-timeout:${escrowC}`));
    const deadline = await authDeadline();
    const sig = signDeliver(signerOf(freelancerAcc), {
      escrow: escrowC,
      m: 0n,
      commitment,
      nonce: (await nonces(escrowC)).freelancer,
      deadline,
    });
    const data = deliverData(0n, commitment, deadline, sig);
    const opened = await withEvmWindow(
      CLIENT,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowC], blocks: 200 },
      async (account) => {
        const priced = await pricedCall({ from: getAddress(account.evm), to: escrowC, data, kind: "call", label: "deliver C m0" });
        return sendPriced({ account, to: escrowC, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "deliver C m0" });
      },
    );
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "client opens scoped window [C] to relay deliver m0" },
      { hash: opened.result.hash, tier: "classical", note: `deliver C m0 (freelancer sig) gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
      { hash: opened.closeHash, tier: "pqc", note: "client closes deliver C window" },
    );
    writeJson(REPORT, report);
    console.log(`delivered C m0: ${opened.result.hash}`);
  }

  // 4. Dispute milestone 0 (client ML-DSA-87 signature).
  if ((await milestone(escrowC, 0n)).status === Status.Delivered) {
    const deadline = await authDeadline();
    const sig = signDispute(signerOf(clientAcc), {
      escrow: escrowC,
      m: 0n,
      byClient: true,
      nonce: (await nonces(escrowC)).client,
      deadline,
    });
    const data = disputeData(0n, true, deadline, sig);
    const opened = await withEvmWindow(
      CLIENT,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowC], blocks: 200 },
      async (account) => {
        const priced = await pricedCall({ from: getAddress(account.evm), to: escrowC, data, kind: "call", label: "dispute C m0" });
        return sendPriced({ account, to: escrowC, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "dispute C m0" });
      },
    );
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "client opens scoped window [C] for client dispute m0" },
      { hash: opened.result.hash, tier: "classical", note: `dispute C m0 gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
      { hash: opened.closeHash, tier: "pqc", note: "client closes dispute C window" },
    );
    writeJson(REPORT, report);
    console.log(`disputed C m0: ${opened.result.hash}`);
  }

  // 5. Refuse resolveTimeout before arbiterTimeout expires (TooEarly).
  const disputed = await milestone(escrowC, 0n);
  const earlyRecorded = report.transactions.some((tx) => tx.note.includes("resolveTimeout before arbiterTimeout"));
  if (disputed.status === Status.Disputed && !earlyRecorded) {
    if ((await chainTime()) > disputed.disputedAt + ARBITER_TIMEOUT) {
      throw new Error("arbiterTimeout already passed before TooEarly refusal was recorded");
    }
    const data = resolveTimeoutData(0n);
    const opened = await withEvmWindow(
      CLIENT,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowC], blocks: 200 },
      async (account) => refuse({ account, to: escrowC, data, kind: "call", label: "resolveTimeout too early" }),
    );
    if (opened.result.errorName !== "TooEarly") {
      throw new Error(`early resolveTimeout reverted ${opened.result.errorName}, expected TooEarly`);
    }
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "client opens scoped window [C] for early resolveTimeout" },
      { hash: opened.result.hash, tier: "refused", note: `resolveTimeout before arbiterTimeout -> ${opened.result.errorName}` },
      { hash: opened.closeHash, tier: "pqc", note: "client closes early resolveTimeout window" },
    );
    writeJson(REPORT, report);
    console.log(`early resolveTimeout refused: ${opened.result.errorName} (${opened.result.hash})`);
  }

  // 6. Wait for the real chain clock to pass disputedAt + 60s.
  const readyAt = (await milestone(escrowC, 0n)).disputedAt + ARBITER_TIMEOUT;
  console.log(`waiting for chain timestamp > ${readyAt}...`);
  while ((await milestone(escrowC, 0n)).status === Status.Disputed && (await chainTime()) <= readyAt) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  // 7. Call resolveTimeout(0) after arbiterTimeout passes.
  if ((await milestone(escrowC, 0n)).status === Status.Disputed) {
    const data = resolveTimeoutData(0n);
    const opened = await withEvmWindow(
      CLIENT,
      { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [escrowC], blocks: 200 },
      async (account) => {
        const priced = await pricedCall({ from: getAddress(account.evm), to: escrowC, data, kind: "call", label: "resolveTimeout C m0" });
        return sendPriced({ account, to: escrowC, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: "resolveTimeout C m0" });
      },
    );
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: "client opens scoped window [C] after arbiterTimeout" },
      { hash: opened.result.hash, tier: "classical", note: `resolveTimeout C m0 (5000 bps) gasUsed ${opened.result.gasUsed} fee ${opened.result.uqor} uqor` },
      { hash: opened.closeHash, tier: "pqc", note: "client closes resolveTimeout window" },
    );
    writeJson(REPORT, report);
    console.log(`resolveTimeout C m0 landed: ${opened.result.hash}`);
  }

  if ((await milestone(escrowC, 0n)).status !== Status.Resolved) {
    throw new Error("C m0 did not resolve on timeout");
  }
  const clientDelta = (await fusdOf(clientEvm)) - BigInt(report.clientBefore);
  const freelancerDelta = (await fusdOf(freelancerEvm)) - BigInt(report.freelancerBefore);
  if (clientDelta !== 50_000n || freelancerDelta !== 50_000n) {
    throw new Error(`unexpected split deltas: client +${clientDelta}, freelancer +${freelancerDelta}`);
  }
  const left = await fusdOf(escrowC);
  if (left !== 0n) throw new Error(`escrow C still holds ${left} fUSD`);

  report.clientDelta = clientDelta.toString();
  report.freelancerDelta = freelancerDelta.toString();
  report.ok = true;
  report.ranAt = new Date().toISOString();
  writeJson(REPORT, report);
  console.log(`C m0 resolved by timeout (5000 bps). Client +${clientDelta}, Freelancer +${freelancerDelta}. Escrow C holds 0 fUSD.`);
  await printBalanceDelta();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
