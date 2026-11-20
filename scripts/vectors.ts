/**
 * Fixed authorisation vectors. Running this twice writes the same bytes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { TESTNET } from "haven-pq-kit/network";
import { encodeAuthMessage } from "haven-pq-kit/pqauth";
import { quorumAction } from "haven-pq-kit/quorum";
import {
  ACTIONS,
  CHAIN_ID,
  cancelArgs,
  deliverArgs,
  disputeArgs,
  releaseArgs,
  resolveArgs,
} from "../src/ts/escrow.js";

const escrow = getAddress(`0x${"33".repeat(20)}`);
const client = getAddress(`0x${"11".repeat(20)}`);
const freelancer = getAddress(`0x${"22".repeat(20)}`);
const m = 1n;
const amount = 1_000_000n;
const splitBps = 7000;
const nonce = 4n;
const deadline = 1_700_003_600n;
const commitment = keccak256(toBytes("haven-escrow.vectors.commitment"));

const args = {
  deliver: deliverArgs(m, commitment),
  release: releaseArgs(m, amount),
  disputeByClient: disputeArgs(m, true),
  disputeByFreelancer: disputeArgs(m, false),
  cancel: cancelArgs(m),
  resolve: resolveArgs(m, splitBps),
};

function message(signer: Address, action: Hex, argsHash: Hex): Hex {
  return encodeAuthMessage({
    chainId: CHAIN_ID,
    contract: escrow,
    signer,
    action,
    nonce,
    deadline,
    argsHash,
  });
}

const vectors = {
  network: TESTNET.chainId,
  chainId: Number(CHAIN_ID),
  escrow,
  client,
  freelancer,
  m: Number(m),
  commitment,
  amount: Number(amount),
  splitBps,
  nonce: Number(nonce),
  deadline: Number(deadline),
  actions: ACTIONS,
  args,
  messages: {
    deliver: message(freelancer, ACTIONS.deliver, args.deliver),
    release: message(client, ACTIONS.release, args.release),
    disputeByClient: message(client, ACTIONS.dispute, args.disputeByClient),
    disputeByFreelancer: message(freelancer, ACTIONS.dispute, args.disputeByFreelancer),
    cancelClient: message(client, ACTIONS.cancel, args.cancel),
    cancelFreelancer: message(freelancer, ACTIONS.cancel, args.cancel),
  },
  quorumAction: quorumAction(ACTIONS.resolve),
};

mkdirSync("vectors", { recursive: true });
writeFileSync("vectors/escrow.json", `${JSON.stringify(vectors, null, 2)}\n`);
console.log("wrote vectors/escrow.json");
