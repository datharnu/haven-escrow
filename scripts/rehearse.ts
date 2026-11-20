/**
 * Scene 2. A thief who has only escrow-client's secp256k1 key.
 * The first two attempts have no window. The third is inside a window the
 * owner opened; the attacker signs with the same classical key.
 */
import { readFileSync } from "node:fs";
import { concat, createWalletClient, encodeAbiParameters, getAddress, http, toFunctionSelector, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { closeEvmWindowMsg, openEvmWindowMsg } from "@qorechain/sdk";
import { TESTNET, qorechainDiana } from "haven-pq-kit/network";
import { broadcast, evmClient, loadAccount, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";
import {
  CLIENT,
  Status,
  brief,
  cancelData,
  fusdOf,
  junkSignature,
  milestone,
  refuse,
  releaseData,
  windowLive,
  writeJson,
  type Tx,
} from "./lib/live.js";

const REPORT = "deployments/scene-2-rehearse.json";

type Refusal = { accepted: boolean; hash?: string; text: string; errorName?: string };

type Report = {
  network: string;
  ranAt?: string;
  ok: boolean;
  windowNote: string;
  noWindow?: Refusal;
  classicalOpen?: Refusal;
  junkRelease?: Refusal;
  replayedRelease?: Refusal;
  cancel?: Refusal;
  cancelNote?: string;
  missingFunction?: { reverted: boolean; text: string };
  escrowBalance?: string;
  transactions: Tx[];
};

function load(): Report {
  try {
    return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
  } catch {
    return {
      network: "qorechain-diana",
      ok: false,
      windowNote: "a window the owner opened; the attacker signs with the same classical key",
      transactions: [],
    };
  }
}

function sceneOne(): { escrowA: Address; releaseSignature: Hex; releaseDeadline: string } {
  const escrow = JSON.parse(readFileSync("deployments/escrow.json", "utf8")) as { ok?: boolean; escrowA?: Address };
  const scene = JSON.parse(readFileSync("deployments/scene-1.json", "utf8")) as {
    ok?: boolean;
    releaseSignature?: Hex;
    releaseDeadline?: string;
  };
  if (!escrow.ok || !escrow.escrowA || !scene.ok || !scene.releaseSignature || !scene.releaseDeadline) {
    throw new Error("scene 1 is not ok");
  }
  return { escrowA: escrow.escrowA, releaseSignature: scene.releaseSignature, releaseDeadline: scene.releaseDeadline };
}

async function main(): Promise<void> {
  const report = load();
  if (report.ok) throw new Error("already ran");
  const { escrowA, releaseSignature, releaseDeadline } = sceneOne();
  const owner = await loadAccount(CLIENT);
  const row = await milestone(escrowA, 1n);
  if (row.status !== Status.Delivered) throw new Error(`A m1 status ${row.status}, expected Delivered`);
  if (await windowLive(owner.cosmos)) throw new Error("escrow-client already has a live window");

  const before = report.escrowBalance ? BigInt(report.escrowBalance) : await fusdOf(escrowA);
  report.escrowBalance = before.toString();
  const junk = junkSignature();
  const deadline = BigInt(releaseDeadline);
  const attacker = privateKeyToAccount(owner.privateKey as Hex);
  const wallet = createWalletClient({ account: attacker, chain: qorechainDiana, transport: http(TESTNET.evmRpc) });

  if (!report.noWindow) {
    let hash: Hex | undefined;
    try {
      hash = await wallet.sendTransaction({ to: escrowA, data: releaseData(1n, deadline, junk), gas: 1_500_000n });
      const receipt = await evmClient().waitForTransactionReceipt({ hash });
      report.noWindow = { accepted: receipt.status === "success", hash, text: `receipt status ${receipt.status}` };
      if (receipt.status === "success") {
        writeJson(REPORT, report);
        throw new Error("no-window release was accepted");
      }
      report.transactions.push({ hash, tier: "refused", note: "classical release with no window, mined as a revert" });
    } catch (error) {
      if (error instanceof Error && error.message === "no-window release was accepted") throw error;
      report.noWindow = { accepted: false, hash, text: brief(error instanceof Error ? error.message : String(error)) };
      if (hash) report.transactions.push({ hash, tier: "refused", note: "classical release with no window" });
    }
    writeJson(REPORT, report);
    console.log(`no window: ${report.noWindow.text}`);
  }

  if (!report.classicalOpen) {
    try {
      const hash = await broadcast(
        owner,
        [openEvmWindowMsg({ sender: owner.cosmos, blocks: 120, maxTxs: 1, maxValue: WINDOW_CAP.call.toString() })],
        "classical",
      );
      report.classicalOpen = { accepted: true, hash, text: "classical MsgOpenEVMWindow was accepted" };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const hash = text.match(/tx ([0-9A-Fa-f]{64}) failed/)?.[1];
      report.classicalOpen = { accepted: false, hash, text: brief(text) };
      if (hash) report.transactions.push({ hash, tier: "refused", note: "classical MsgOpenEVMWindow refused" });
    }
    if (report.classicalOpen.accepted) {
      try {
        await broadcast(owner, [closeEvmWindowMsg(owner.cosmos)]);
      } catch (error) {
        report.classicalOpen.text += ` Close attempt: ${brief(error instanceof Error ? error.message : String(error))}`;
      }
      writeJson(REPORT, report);
      throw new Error("classical MsgOpenEVMWindow was accepted");
    }
    writeJson(REPORT, report);
    console.log(`classical open: ${report.classicalOpen.text}`);
  }

  if (!report.junkRelease || !report.replayedRelease || !report.cancel) {
    const opened = await withEvmWindow(
      CLIENT,
      { txs: 3, maxValueUqor: (WINDOW_CAP.call * 3n).toString(), targets: [escrowA], blocks: 200 },
      async (account) => {
        const junked = await refuse({
          account,
          to: escrowA,
          data: releaseData(1n, deadline, junk),
          kind: "call",
          label: "junk release",
        });
        if (junked.errorName !== "SignatureInvalid") throw new Error(`junk release reverted ${junked.errorName}`);
        const replayed = await refuse({
          account,
          to: escrowA,
          data: releaseData(1n, deadline, releaseSignature),
          kind: "call",
          label: "replayed release",
        });
        if (replayed.errorName !== "SignatureInvalid") throw new Error(`replayed release reverted ${replayed.errorName}`);
        const cancelled = await refuse({
          account,
          to: escrowA,
          data: cancelData(1n, deadline, junk, junk),
          kind: "call",
          label: "junk cancel",
        });
        return { junked, replayed, cancelled };
      },
    );
    const named = (row: { hash: Hex; errorName: string; gasUsed: bigint; uqor: bigint }, note: string): Refusal => ({
      accepted: false,
      hash: row.hash,
      errorName: row.errorName,
      text: row.errorName,
    });
    report.junkRelease = named(opened.result.junked, "junk");
    report.replayedRelease = named(opened.result.replayed, "replay");
    report.cancel = named(opened.result.cancelled, "cancel");
    report.transactions.push(
      { hash: opened.openHash, tier: "pqc", note: report.windowNote },
      { hash: opened.result.junked.hash, tier: "refused", note: `release(1) junk signature -> ${opened.result.junked.errorName}` },
      { hash: opened.result.replayed.hash, tier: "refused", note: `release(1) replayed m0 signature -> ${opened.result.replayed.errorName}` },
      { hash: opened.result.cancelled.hash, tier: "refused", note: `cancel(1) junk signatures -> ${opened.result.cancelled.errorName}` },
      { hash: opened.closeHash, tier: "pqc", note: "close the owner-opened rehearsal window" },
    );
    writeJson(REPORT, report);
  }

  if (!report.missingFunction) {
    const data = concat([
      toFunctionSelector("release(uint256,address)"),
      encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [1n, getAddress(owner.evm)]),
    ]);
    try {
      await evmClient().call({ to: escrowA, data });
      report.missingFunction = { reverted: false, text: "the call returned" };
      writeJson(REPORT, report);
      throw new Error("release(uint256,address) did not revert");
    } catch (error) {
      if (error instanceof Error && error.message === "release(uint256,address) did not revert") throw error;
      report.missingFunction = { reverted: true, text: brief(error instanceof Error ? error.message : String(error)) };
      writeJson(REPORT, report);
    }
  }

  const after = await fusdOf(escrowA);
  if (after !== before) throw new Error(`escrow A fUSD changed from ${before} to ${after}`);
  if (report.cancel?.errorName !== "WrongStatus") {
    writeJson(REPORT, report);
    throw new Error(`cancel(1) reverted ${report.cancel?.errorName ?? "nothing"}, expected WrongStatus. Stopped.`);
  }
  report.cancelNote =
    "The prompt expected SignatureInvalid. A m1 is Delivered and cancel checks status before any signature, so the chain refused with WrongStatus. Approved 20 November 2026: the contract was not reordered.";
  report.ok = true;
  report.ranAt = new Date().toISOString();
  writeJson(REPORT, report);
  console.log("rehearsal refused the classical key. Escrow A balance did not change.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
