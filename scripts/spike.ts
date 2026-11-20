/**
 * Spike for Haven Escrow. Not part of the product.
 * Deploys SpikeTarget, proves a relayer can submit an ML-DSA ping, records whether
 * a scoped window allows contract creation, and rehearses a classical-key refusal.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { evmWindowCost, weiToUqorCeil } from "@qorechain/evm";
import { closeEvmWindowMsg, fetchEvmWindow, openEvmWindowMsg } from "@qorechain/sdk";
import { TESTNET, qorechainDiana } from "haven-pq-kit/network";
import { signAuth } from "haven-pq-kit/pqauth";
import {
  createWalletClient,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  broadcast,
  evmClient,
  loadAccount,
  sendExpectedRevert,
  sendScopedContractTx,
  withEvmWindow,
} from "./lib/chain.js";

const REPORT = "deployments/spikes.json";
const CLIENT = "escrow-client";
const RELAYER = "escrow-freelancer";
const DEPLOYER = "spike";
const DEPLOY_CAP = 5_000_000n;
const CALL_CAP = 2_000_000n;
const CALL_GAS = 1_500_000n;

type Tx = { hash: string; tier: "pqc" | "enrollment" | "classical" | "refused"; note: string };
type GasRow = { label: string; hash: string; gasUsed: string; effectiveGasPrice: string; uqor: string };
type Report = {
  network: string;
  ranAt?: string;
  spikeTarget?: Address;
  owner?: Address;
  steps: Record<string, unknown>;
  gas: GasRow[];
  windows: { label: string; openHash: string; closeHash: string; usedValue: string; cap: string }[];
  transactions: Tx[];
  createInCall: "succeeded" | "refused";
  ok: boolean;
};

function loadReport(): Report {
  if (!existsSync(REPORT)) {
    return { network: "qorechain-diana", steps: {}, gas: [], windows: [], transactions: [], createInCall: "refused", ok: false };
  }
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function save(report: Report): void {
  mkdirSync("deployments", { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}

function assertUnderCap(kind: "deploy" | "call", uqor: bigint, label: string): void {
  const cap = kind === "deploy" ? DEPLOY_CAP : CALL_CAP;
  const limit = (cap * 66n) / 100n;
  if (uqor > limit) {
    throw new Error(`${label} cost ${uqor} uqor is above 66% of the ${cap} uqor cap (${limit})`);
  }
}

async function windowUsed(cosmos: string): Promise<bigint> {
  const win = await fetchEvmWindow({ rest: TESTNET.rest, address: cosmos });
  return win.usedValue;
}

async function main(): Promise<void> {
  const existing = loadReport();
  if (existing.ok) throw new Error("already ran; delete deployments/spikes.json only if the user agrees");
  if (existing.transactions.length > 0 && !existing.steps.S1) {
    throw new Error("a previous spike did not finish; delete deployments/spikes.json only if the user agrees");
  }

  const report = existing;

  const client = evmClient();
  const owner = await loadAccount(CLIENT);
  const block = await client.getBlock();
  const deadline = block.timestamp + 600n;
  const pingAction = keccak256(toBytes("haven-escrow.spike.ping"));

  const artifact = JSON.parse(readFileSync("out/SpikeTarget.sol/SpikeTarget.json", "utf8")) as {
    abi: Abi;
    bytecode: { object: Hex };
  };
  if (!report.steps.S1) {
  const deployData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [owner.evm],
  });

  const deployed = await withEvmWindow(DEPLOYER, { txs: 1, maxValueUqor: DEPLOY_CAP.toString(), blocks: 200 }, async (account) => {
    const signer = privateKeyToAccount(account.privateKey as Hex);
    const nonce = await client.getTransactionCount({ address: signer.address, blockTag: "pending" });
    const gasPrice = await client.getGasPrice();
    const gas = await client.estimateGas({ account: signer, data: deployData });
    const budget = evmWindowCost({ gas, maxFeePerGas: gasPrice });
    assertUnderCap("deploy", budget, "S1 deploy budget");
    const signed = await signer.signTransaction({
      chainId: qorechainDiana.id,
      nonce,
      gas,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
      data: deployData,
      type: "eip1559",
    });
    const createHash = await client.sendRawTransaction({ serializedTransaction: signed });
    const created = await client.waitForTransactionReceipt({ hash: createHash });
    if (created.status !== "success" || !created.contractAddress) throw new Error(`deploy failed: ${createHash}`);
    const spent = weiToUqorCeil(created.gasUsed * created.effectiveGasPrice);
    assertUnderCap("deploy", spent, "S1 deploy");
    const used = await windowUsed(account.cosmos);
    return {
      createHash,
      address: created.contractAddress,
      gasUsed: created.gasUsed,
      effectiveGasPrice: created.effectiveGasPrice,
      uqor: spent,
      used,
      deployer: account.evm,
    };
  });

  const code = await client.getCode({ address: deployed.result.address });
  if (!code || code === "0x") throw new Error(`no code at ${deployed.result.address}`);
  report.spikeTarget = deployed.result.address.toLowerCase() as Address;
  report.owner = owner.evm.toLowerCase() as Address;
  report.transactions.push(
    { hash: deployed.openHash, tier: "pqc", note: "S1 open unscoped deploy window" },
    { hash: deployed.result.createHash, tier: "classical", note: "S1 deploy SpikeTarget" },
    { hash: deployed.closeHash, tier: "pqc", note: "S1 close deploy window" },
  );
  report.gas.push({
    label: "S1 deploy",
    hash: deployed.result.createHash,
    gasUsed: deployed.result.gasUsed.toString(),
    effectiveGasPrice: deployed.result.effectiveGasPrice.toString(),
    uqor: deployed.result.uqor.toString(),
  });
  report.windows.push({
    label: "S1 deploy",
    openHash: deployed.openHash,
    closeHash: deployed.closeHash,
    usedValue: deployed.result.used.toString(),
    cap: DEPLOY_CAP.toString(),
  });
  report.steps.S1 = {
    spikeTarget: report.spikeTarget,
    createHash: deployed.result.createHash,
    openHash: deployed.openHash,
    closeHash: deployed.closeHash,
    gasUsed: deployed.result.gasUsed.toString(),
    uqor: deployed.result.uqor.toString(),
  };
  save(report);
  }

  const target = report.spikeTarget;
  if (!target || !report.owner) throw new Error("S1 did not record the contract");
  const pingsNow = (await client.readContract({ address: target, abi: artifact.abi, functionName: "pings" })) as bigint;

  const pingData = (signature: Hex): Hex =>
    encodeFunctionData({
      abi: artifact.abi,
      functionName: "ping",
      args: [deadline, signature],
    });
  if (!report.steps.S2) {
    if (pingsNow === 0n) {
      const signed = signAuth(owner.pqc.secretKey, {
        chainId: BigInt(TESTNET.evmChainId),
        contract: target,
        signer: owner.evm as Address,
        action: pingAction,
        nonce: 0n,
        deadline,
        argsHash: keccak256(encodeAbiParameters([{ type: "uint256" }], [0n])),
      });
      const relayed = await withEvmWindow(
        RELAYER,
        { txs: 2, maxValueUqor: (CALL_CAP * 2n).toString(), targets: [target], blocks: 200 },
        async (account) => {
          const price = await client.getGasPrice();
          assertUnderCap("call", evmWindowCost({ gas: CALL_GAS, maxFeePerGas: price }), "S2 ping budget");
          assertUnderCap("call", evmWindowCost({ gas: CALL_GAS, maxFeePerGas: price }), "S2 replay budget");
          const pingHash = await sendScopedContractTx({ account, to: target, data: pingData(signed.signature) });
          const pingReceipt = await client.getTransactionReceipt({ hash: pingHash });
          const pingCost = weiToUqorCeil(pingReceipt.gasUsed * pingReceipt.effectiveGasPrice);
          assertUnderCap("call", pingCost, "S2 ping");
          const pings = await client.readContract({ address: target, abi: artifact.abi, functionName: "pings" });
          if (pings !== 1n) throw new Error(`expected pings 1, got ${String(pings)}`);
          const replay = await sendExpectedRevert({ account, to: target, data: pingData(signed.signature), gas: CALL_GAS });
          if (replay.errorName !== "SignatureInvalid") throw new Error(`expected SignatureInvalid, got ${replay.errorName}`);
          const replayReceipt = await client.getTransactionReceipt({ hash: replay.hash });
          const replayCost = weiToUqorCeil(replayReceipt.gasUsed * replayReceipt.effectiveGasPrice);
          assertUnderCap("call", replayCost, "S2 replay");
          const used = await windowUsed(account.cosmos);
          return { pingHash, pingReceipt, pingCost, replay, replayReceipt, replayCost, used, openHash: "", closeHash: "" };
        },
      );
      report.transactions.push(
        { hash: relayed.openHash, tier: "pqc", note: "S2 open relayer window" },
        { hash: relayed.result.pingHash, tier: "classical", note: "S2 relayer submits client ML-DSA ping" },
        { hash: relayed.result.replay.hash, tier: "refused", note: "S2 replay of the same ping refused SignatureInvalid" },
        { hash: relayed.closeHash, tier: "pqc", note: "S2 close relayer window" },
      );
      report.gas.push(
        { label: "S2 ping", hash: relayed.result.pingHash, gasUsed: relayed.result.pingReceipt.gasUsed.toString(), effectiveGasPrice: relayed.result.pingReceipt.effectiveGasPrice.toString(), uqor: relayed.result.pingCost.toString() },
        { label: "S2 replay", hash: relayed.result.replay.hash, gasUsed: relayed.result.replayReceipt.gasUsed.toString(), effectiveGasPrice: relayed.result.replayReceipt.effectiveGasPrice.toString(), uqor: relayed.result.replayCost.toString() },
      );
      report.windows.push({ label: "S2 relayer", openHash: relayed.openHash, closeHash: relayed.closeHash, usedValue: relayed.result.used.toString(), cap: (CALL_CAP * 2n).toString() });
      report.steps.S2 = { openHash: relayed.openHash, pingHash: relayed.result.pingHash, pings: 1, replayHash: relayed.result.replay.hash, replayError: relayed.result.replay.errorName, closeHash: relayed.closeHash };
    } else if (pingsNow === 1n) {
      const pending = report.steps.pendingPing as { hash: Hex; openHash: string; closeHash: string } | undefined;
      if (!pending?.hash) throw new Error("the ping is already on chain, but steps.pendingPing.hash is missing");
      const pingTx = await client.getTransaction({ hash: pending.hash });
      const pingReceipt = await client.getTransactionReceipt({ hash: pending.hash });
      const pingCost = weiToUqorCeil(pingReceipt.gasUsed * pingReceipt.effectiveGasPrice);
      assertUnderCap("call", pingCost, "S2 ping");
      const relayed = await withEvmWindow(
        RELAYER,
        { txs: 1, maxValueUqor: CALL_CAP.toString(), targets: [target], blocks: 200 },
        async (account) => {
          const price = await client.getGasPrice();
          assertUnderCap("call", evmWindowCost({ gas: CALL_GAS, maxFeePerGas: price }), "S2 replay budget");
          const replay = await sendExpectedRevert({ account, to: target, data: pingTx.input, gas: CALL_GAS });
          if (replay.errorName !== "SignatureInvalid") throw new Error(`expected SignatureInvalid, got ${replay.errorName}`);
          const replayReceipt = await client.getTransactionReceipt({ hash: replay.hash });
          const replayCost = weiToUqorCeil(replayReceipt.gasUsed * replayReceipt.effectiveGasPrice);
          assertUnderCap("call", replayCost, "S2 replay");
          const used = await windowUsed(account.cosmos);
          return { replay, replayReceipt, replayCost, used };
        },
      );
      report.transactions.push(
        { hash: pending.openHash, tier: "pqc", note: "S2 open the window that submitted the ping" },
        { hash: pending.hash, tier: "classical", note: "S2 relayer submits client ML-DSA ping" },
        { hash: pending.closeHash, tier: "pqc", note: "S2 close that window. The replay had not been sent." },
        { hash: relayed.openHash, tier: "pqc", note: "S2 open a second window for the replay" },
        { hash: relayed.result.replay.hash, tier: "refused", note: "S2 replay of the same ping refused SignatureInvalid" },
        { hash: relayed.closeHash, tier: "pqc", note: "S2 close the replay window" },
      );
      report.gas.push(
        { label: "S2 ping", hash: pending.hash, gasUsed: pingReceipt.gasUsed.toString(), effectiveGasPrice: pingReceipt.effectiveGasPrice.toString(), uqor: pingCost.toString() },
        { label: "S2 replay", hash: relayed.result.replay.hash, gasUsed: relayed.result.replayReceipt.gasUsed.toString(), effectiveGasPrice: relayed.result.replayReceipt.effectiveGasPrice.toString(), uqor: relayed.result.replayCost.toString() },
      );
      report.windows.push({
        label: "S2 replay",
        openHash: relayed.openHash,
        closeHash: relayed.closeHash,
        usedValue: relayed.result.used.toString(),
        cap: CALL_CAP.toString(),
      });
      report.steps.S2 = {
        openHash: pending.openHash,
        pingHash: pending.hash,
        pings: 1,
        replayHash: relayed.result.replay.hash,
        replayError: relayed.result.replay.errorName,
        replayOpenHash: relayed.openHash,
        replayCloseHash: relayed.closeHash,
        closeHash: pending.closeHash,
        note: "The ping and the replay are in two windows. The first run could not read the revert data, so it closed the window without sending the replay.",
      };
    } else {
      throw new Error(`unexpected ping count ${pingsNow}`);
    }
    save(report);
  }

  const spawnData = encodeFunctionData({ abi: artifact.abi, functionName: "spawn" });
  const spawned = await withEvmWindow(
    DEPLOYER,
    { txs: 1, maxValueUqor: CALL_CAP.toString(), targets: [target], blocks: 200 },
    async (account) => {
      const price = await client.getGasPrice();
      const signer = privateKeyToAccount(account.privateKey as Hex);
      const wallet = createWalletClient({ account: signer, chain: qorechainDiana, transport: http(TESTNET.evmRpc) });
      let gas = CALL_GAS;
      try {
        gas = await client.estimateGas({ account: signer, to: target, data: spawnData });
      } catch {
        gas = CALL_GAS;
      }
      assertUnderCap("call", evmWindowCost({ gas, maxFeePerGas: price }), "S3 spawn budget");
      try {
        const hash = await wallet.sendTransaction({ to: target, data: spawnData, gas });
        const receipt = await client.waitForTransactionReceipt({ hash });
        const uqor = weiToUqorCeil(receipt.gasUsed * receipt.effectiveGasPrice);
        assertUnderCap("call", uqor, "S3 spawn");
        const used = await windowUsed(account.cosmos);
        if (receipt.status !== "success") {
          return { outcome: "refused" as const, hash, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, uqor, used, verbatim: `receipt status ${receipt.status}` };
        }
        return { outcome: "succeeded" as const, hash, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, uqor, used, verbatim: "success" };
      } catch (error) {
        const verbatim = error instanceof Error ? error.message : String(error);
        const used = await windowUsed(account.cosmos);
        return { outcome: "refused" as const, verbatim, used, hash: undefined as Hex | undefined, gasUsed: undefined, effectiveGasPrice: undefined, uqor: undefined };
      }
    },
  );
  report.createInCall = spawned.result.outcome;
  if (spawned.result.hash) {
    report.transactions.push({
      hash: spawned.result.hash,
      tier: spawned.result.outcome === "succeeded" ? "classical" : "refused",
      note: "S3 spawn inside a scoped window",
    });
    if (spawned.result.gasUsed !== undefined && spawned.result.effectiveGasPrice !== undefined && spawned.result.uqor !== undefined) {
      report.gas.push({
        label: "S3 spawn",
        hash: spawned.result.hash,
        gasUsed: spawned.result.gasUsed.toString(),
        effectiveGasPrice: spawned.result.effectiveGasPrice.toString(),
        uqor: spawned.result.uqor.toString(),
      });
    }
  }
  report.transactions.push(
    { hash: spawned.openHash, tier: "pqc", note: "S3 open scoped window" },
    { hash: spawned.closeHash, tier: "pqc", note: "S3 close scoped window" },
  );
  report.windows.push({
    label: "S3 spawn",
    openHash: spawned.openHash,
    closeHash: spawned.closeHash,
    usedValue: spawned.result.used.toString(),
    cap: CALL_CAP.toString(),
  });
  report.steps.S3 = {
    outcome: spawned.result.outcome,
    verbatim: spawned.result.verbatim,
    hash: spawned.result.hash ?? null,
    openHash: spawned.openHash,
    closeHash: spawned.closeHash,
    phase4: spawned.result.outcome === "succeeded" ? "EscrowFactory.create runs in a scoped window [factory]" : "EscrowFactory.create runs in an unscoped window",
  };
  save(report);

  const clientWindow = await fetchEvmWindow({ rest: TESTNET.rest, address: owner.cosmos });
  if (clientWindow.live) throw new Error("escrow-client already has a live window; S4 would not be a no-window refusal");
  const zeroSig = `0x${"00".repeat(4627)}` as Hex;
  const attacker = privateKeyToAccount(owner.privateKey as Hex);
  const wallet = createWalletClient({ account: attacker, chain: qorechainDiana, transport: http(TESTNET.evmRpc) });
  let s4a: { accepted: boolean; hash?: string; text: string };
  let s4aHash: Hex | undefined;
  try {
    s4aHash = await wallet.sendTransaction({ to: target, data: pingData(zeroSig), gas: CALL_GAS });
    const receipt = await client.waitForTransactionReceipt({ hash: s4aHash });
    s4a = { accepted: receipt.status === "success", hash: s4aHash, text: `receipt status ${receipt.status}` };
    if (receipt.status === "success") {
      report.steps.S4 = { a: s4a };
      save(report);
      throw new Error("S4a was accepted: the scene story changes");
    }
    report.transactions.push({ hash: s4aHash, tier: "refused", note: "S4a classical ping with no window" });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("S4a was accepted")) throw error;
    s4a = { accepted: false, hash: s4aHash, text: brief(error instanceof Error ? error.message : String(error)) };
    if (s4aHash) report.transactions.push({ hash: s4aHash, tier: "refused", note: "S4a classical ping with no window" });
  }

  let s4b: { accepted: boolean; hash?: string; text: string };
  try {
    const hash = await broadcast(
      owner,
      [openEvmWindowMsg({ sender: owner.cosmos, blocks: 120, maxTxs: 1, maxValue: CALL_CAP.toString() })],
      "classical",
    );
    s4b = { accepted: true, hash, text: "classical MsgOpenEVMWindow was accepted" };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const hash = text.match(/tx ([0-9A-Fa-f]{64}) failed/)?.[1];
    s4b = { accepted: false, hash, text: brief(text) };
    if (hash) report.transactions.push({ hash, tier: "refused", note: "S4b classical MsgOpenEVMWindow refused" });
  }
  if (s4b.accepted) {
    try {
      await broadcast(owner, [closeEvmWindowMsg(owner.cosmos)], "hybrid");
    } catch (error) {
      s4b.text += ` Close attempt: ${error instanceof Error ? error.message : String(error)}`;
    }
    report.steps.S4 = { a: s4a, b: s4b };
    save(report);
    throw new Error("S4b was accepted: the scene story changes");
  }
  report.steps.S4 = { a: s4a, b: s4b };
  report.steps.S5 = { gas: report.gas, windows: report.windows };
  report.ranAt = new Date().toISOString();
  report.ok = true;
  save(report);
  writeSpikesDoc(report);
  console.log(`spike target ${report.spikeTarget}`);
  console.log(`S3 ${report.createInCall}`);
  for (const row of report.gas) console.log(`${row.label} gasUsed=${row.gasUsed} uqor=${row.uqor}`);
  for (const row of report.windows) console.log(`${row.label} window used ${row.usedValue} of ${row.cap}`);
}

function brief(text: string): string {
  const noWindow = text.match(/failed to broadcast transaction:.{0,320}/);
  if (noWindow) return noWindow[0].split("Version:")[0].trim();
  const refused = text.match(/Broadcasting transaction failed with code \d+ \(codespace: [^)]+\)\. Log: [^\n]+/);
  if (refused) return refused[0];
  const line = text.split("\n").find((part) => part.startsWith("Details:") || part.startsWith("tx "));
  return (line ?? text).slice(0, 400);
}
function writeSpikesDoc(report: Report): void {
  const s1 = report.steps.S1 as { createHash: string; openHash: string; closeHash: string; gasUsed: string; uqor: string };
  const s2 = report.steps.S2 as { pingHash: string; replayHash: string; replayError: string; openHash: string; closeHash: string };
  const s3 = report.steps.S3 as { outcome: string; verbatim: string; hash: string | null; phase4: string; openHash: string; closeHash: string };
  const s4 = report.steps.S4 as { a: { accepted: boolean; hash?: string; text: string }; b: { accepted: boolean; hash?: string; text: string } };
  const lines = [
    "# Spikes",
    "",
    `${report.ranAt?.slice(0, 10) ?? ""}. SpikeTarget is not part of Haven Escrow. It checks three things the escrow depends on: a relayer with no authority can submit an ML-DSA-87 authorisation, whether a scoped window allows a contract to create another contract, and whether a classical secp256k1 key can act alone.`,
    "",
    `Owner of the spike contract: escrow-client \`${report.owner}\`. Contract: \`${report.spikeTarget}\`.`,
    "",
    "## S1 Deploy",
    "",
    `spike deployed SpikeTarget in an unscoped window. Create \`${s1.createHash}\`, gas used ${s1.gasUsed}, fee ${s1.uqor} uqor. Window open \`${s1.openHash}\`, close \`${s1.closeHash}\`.`,
    "",
    "## S2 Relayer",
    "",
    `escrow-freelancer submitted escrow-client's ML-DSA-87 ping and the ping count became 1. Ping \`${s2.pingHash}\`. The same signature sent again reverted \`${s2.replayError}\` in \`${s2.replayHash}\`. Window open \`${s2.openHash}\`, close \`${s2.closeHash}\`.`,
    (s2 as { note?: string }).note ?? "",
    "",
    "## S3 Create inside a call",
    "",
    `Outcome: ${s3.outcome}. ${s3.verbatim}`,
    s3.hash ? `Transaction \`${s3.hash}\`.` : "No transaction hash was produced.",
    `Window open \`${s3.openHash}\`, close \`${s3.closeHash}\`.`,
    `Phase 4 follows this result: ${s3.phase4}.`,
    "",
    "## S4 Classical key alone",
    "",
    `The sender held only escrow-client's secp256k1 key.`,
    `No window was open. Sending ping with a 4627-byte zero signature was ${s4.a.accepted ? "accepted" : "refused"}. ${s4.a.hash ? `Hash \`${s4.a.hash}\`. ` : "No transaction hash was produced. "}${brief(s4.a.text)}`,
    `A classically signed MsgOpenEVMWindow was ${s4.b.accepted ? "accepted" : "refused"}. ${s4.b.hash ? `Hash \`${s4.b.hash}\`. ` : "No transaction hash was produced. "}${brief(s4.b.text)}`,
    "",
    "## S5 Gas",
    "",
    ...report.gas.map((row) => `- ${row.label}: gas used ${row.gasUsed}, effective gas price ${row.effectiveGasPrice} wei, fee ${row.uqor} uqor, tx \`${row.hash}\`.`),
    ...report.windows.map((row) => `- ${row.label} window spent ${row.usedValue} uqor of a ${row.cap} uqor cap. Open \`${row.openHash}\`, close \`${row.closeHash}\`.`),
    "",
  ];
  mkdirSync("docs", { recursive: true });
  writeFileSync("docs/spikes.md", `${lines.join("\n")}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
