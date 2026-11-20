/**
 * Quotes pool 2, buys at least 3_100_000 fUSD base units for escrow-client,
 * converts 2_000_000 into escrow A and 1_000_000 into escrow B, then calls fund()
 * on each. Refuses a quote that needs more than 6_000_000 uqor.
 */
import { readFileSync } from "node:fs";
import { BinaryWriter } from "cosmjs-types/binary";
import { msg, qorechainRegistry, type EncodeObject } from "@qorechain/sdk";
import { TESTNET } from "haven-pq-kit/network";
import { getAddress, type Address } from "viem";
import { broadcast, loadAccount, pricedCall, sendPriced, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";
import {
  CLIENT,
  FUSD_DENOM,
  Status,
  bankFusd,
  fundData,
  fusdOf,
  milestone,
  uqorOf,
  writeJson,
  type Tx,
} from "./lib/live.js";

const REPORT = "deployments/fund-client.json";
const WANT = 3_100_000n;
const SPEND_CAP = 6_000_000n;
const NEED_A = 2_000_000n;
const NEED_B = 1_000_000n;
const FEE_RESERVE = 3_000_000n;
const CONVERT = "/cosmos.evm.erc20.v1.MsgConvertCoin";

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
  quote?: { spend: string; expected: string; minOut: string; reserveIn: string; reserveOut: string; feeBps: string };
  swap?: string;
  convert?: string;
  transactions: Tx[];
};

function load(): Report {
  try {
    return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
  } catch {
    return { network: "qorechain-diana", ok: false, transactions: [] };
  }
}

function escrows(): { factory: Address; escrowA: Address; escrowB: Address } {
  const doc = JSON.parse(readFileSync("deployments/escrow.json", "utf8")) as {
    ok?: boolean;
    escrowA?: Address;
    escrowB?: Address;
    factory?: Address;
  };
  if (!doc.ok || !doc.escrowA || !doc.escrowB || !doc.factory) throw new Error("deployments/escrow.json is not ok");
  return { factory: doc.factory, escrowA: doc.escrowA, escrowB: doc.escrowB };
}

function quote(reserveIn: bigint, reserveOut: bigint, amountIn: bigint, feeBps: bigint): bigint {
  const net = (amountIn * (10_000n - feeBps)) / 10_000n;
  return (reserveOut * net) / (reserveIn + net);
}

function minSpend(reserveIn: bigint, reserveOut: bigint, feeBps: bigint, want: bigint): bigint {
  if (quote(reserveIn, reserveOut, SPEND_CAP, feeBps) < want) {
    throw new Error(`pool 2 quotes less than ${want} fUSD for ${SPEND_CAP} uqor`);
  }
  let lo = 1n;
  let hi = SPEND_CAP;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (quote(reserveIn, reserveOut, mid, feeBps) >= want) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

async function main(): Promise<void> {
  const report = load();
  if (report.ok) throw new Error("already ran");
  const { escrowA, escrowB } = escrows();
  const owner = await loadAccount(CLIENT);
  const sender = owner.cosmos;

  const [poolsBody, paramsBody] = await Promise.all([
    fetch(`${TESTNET.rest}/qorechain/amm/v1/pools`).then((response) => response.json()) as Promise<{
      pools: { id: string; token_a: string; token_b: string; reserve_a: string; reserve_b: string; status: string }[];
    }>,
    fetch(`${TESTNET.rest}/qorechain/amm/v1/params`).then((response) => response.json()) as Promise<{
      params?: { swap_fee_bps?: string | number };
    }>,
  ]);
  const pool = poolsBody.pools.find((item) => item.id === "2" && item.status === "active");
  if (!pool || pool.token_a !== FUSD_DENOM || pool.token_b !== "uqor") {
    throw new Error(`pool 2 is not uqor/fUSD: ${JSON.stringify(pool)}`);
  }
  const feeBps = BigInt(paramsBody.params?.swap_fee_bps ?? "0");
  if (feeBps >= 10_000n) throw new Error(`swap fee ${feeBps} bps is not a rate`);
  const reserveIn = BigInt(pool.reserve_b);
  const reserveOut = BigInt(pool.reserve_a);

  let bank = await bankFusd(sender);
  if (!report.swap && bank < WANT) {
    const atCap = quote(reserveIn, reserveOut, SPEND_CAP, feeBps);
    if (atCap < WANT) {
      throw new Error(
        `pool 2 quotes ${atCap} fUSD base units for ${SPEND_CAP} uqor, which is below ${WANT}. Not swapping.`,
      );
    }
    const cushion = (WANT * 100n + 89n) / 90n;
    const cushionFits = quote(reserveIn, reserveOut, SPEND_CAP, feeBps) >= cushion;
    const spend = cushionFits ? minSpend(reserveIn, reserveOut, feeBps, cushion) : minSpend(reserveIn, reserveOut, feeBps, WANT);
    const expected = quote(reserveIn, reserveOut, spend, feeBps);
    const minOut = cushionFits ? (expected * 90n) / 100n : WANT;
    if (spend > SPEND_CAP || expected < WANT || minOut < WANT) {
      throw new Error(`quote spend ${spend} expected ${expected} minOut ${minOut} does not clear the cap`);
    }
    const balance = await uqorOf(sender);
    if (balance < spend + FEE_RESERVE) {
      throw new Error(
        `escrow-client has ${balance} uqor. The quote needs ${spend} and ${FEE_RESERVE} must stay for the later windows. Not swapping.`,
      );
    }
    report.quote = {
      spend: spend.toString(),
      expected: expected.toString(),
      minOut: minOut.toString(),
      reserveIn: reserveIn.toString(),
      reserveOut: reserveOut.toString(),
      feeBps: feeBps.toString(),
    };
    writeJson(REPORT, report);
    const swap = await broadcast(owner, [
      msg.amm.swapExactIn({
        sender,
        poolId: "2",
        tokenIn: { denom: "uqor", amount: spend.toString() },
        denomOut: FUSD_DENOM,
        minOut: minOut.toString(),
      }),
    ]);
    report.swap = swap;
    report.transactions.push({ hash: swap, tier: "pqc", note: `swap ${spend} uqor for at least ${minOut} fUSD` });
    writeJson(REPORT, report);
    console.log(`swapped ${spend} uqor, minOut ${minOut}: ${swap}`);
    bank = await bankFusd(sender);
  }
  if (bank < NEED_A + NEED_B) throw new Error(`fUSD bank balance ${bank} is below ${NEED_A + NEED_B}`);

  const haveA = await fusdOf(escrowA);
  const haveB = await fusdOf(escrowB);
  const sendA = haveA >= NEED_A ? 0n : NEED_A - haveA;
  const sendB = haveB >= NEED_B ? 0n : NEED_B - haveB;
  if ((sendA > 0n || sendB > 0n) && !report.convert) {
    if (bank < sendA + sendB) throw new Error(`bank ${bank} cannot cover convert ${sendA}+${sendB}`);
    const messages: EncodeObject[] = [];
    if (sendA > 0n) messages.push({ typeUrl: CONVERT, value: { coin: { denom: FUSD_DENOM, amount: sendA.toString() }, receiver: escrowA, sender } });
    if (sendB > 0n) messages.push({ typeUrl: CONVERT, value: { coin: { denom: FUSD_DENOM, amount: sendB.toString() }, receiver: escrowB, sender } });
    const converted = await broadcast(owner, messages, "hybrid", qorechainRegistry([[CONVERT, ConvertCoin]]));
    report.convert = converted;
    report.transactions.push({
      hash: converted,
      tier: "pqc",
      note: `MsgConvertCoin ${sendA} to escrow A and ${sendB} to escrow B`,
    });
    writeJson(REPORT, report);
    console.log(`converted ${sendA} and ${sendB}: ${converted}`);
  }
  if ((await fusdOf(escrowA)) < NEED_A || (await fusdOf(escrowB)) < NEED_B) {
    throw new Error("the escrows did not receive the fUSD");
  }

  const pending: Address[] = [];
  if ((await milestone(escrowA, 0n)).status === Status.Unfunded) pending.push(escrowA);
  if ((await milestone(escrowB, 0n)).status === Status.Unfunded) pending.push(escrowB);
  if (pending.length > 0) {
    const opened = await withEvmWindow(
      CLIENT,
      { txs: pending.length, maxValueUqor: (WINDOW_CAP.call * BigInt(pending.length)).toString(), targets: pending, blocks: 200 },
      async (account) => {
        const sent = [];
        for (const escrow of pending) {
          const data = fundData();
          const priced = await pricedCall({ from: getAddress(account.evm), to: escrow, data, kind: "call", label: `fund ${escrow}` });
          sent.push({ escrow, ...(await sendPriced({ account, to: escrow, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label: `fund ${escrow}` })) });
        }
        return sent;
      },
    );
    report.transactions.push({ hash: opened.openHash, tier: "pqc", note: "open scoped window for fund()" });
    for (const row of opened.result) {
      report.transactions.push({
        hash: row.hash,
        tier: "classical",
        note: `fund ${row.escrow} gasUsed ${row.gasUsed} fee ${row.uqor} uqor`,
      });
    }
    report.transactions.push({ hash: opened.closeHash, tier: "pqc", note: "close fund window" });
    writeJson(REPORT, report);
  }

  for (const check of [
    [escrowA, 0n],
    [escrowA, 1n],
    [escrowB, 0n],
  ] as const) {
    const row = await milestone(check[0], check[1]);
    if (row.status !== Status.Funded) throw new Error(`${check[0]} m${check[1]} status ${row.status}, expected Funded`);
  }
  report.ok = true;
  report.ranAt = new Date().toISOString();
  writeJson(REPORT, report);
  console.log("A m0, A m1, and B m0 are Funded");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
