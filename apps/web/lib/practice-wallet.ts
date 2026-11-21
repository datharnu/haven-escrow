import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import {
  getQorexNative,
  hasCapability,
  isQorexInstalled,
  qorexSignAndBroadcast,
} from "@qorechain/qorex-types";
import { addQoreEvmToWallet } from "@qorechain/wallet-adapter";

const CHAIN = "qorechain-diana";
const RPC = "https://evm-testnet.qore.host";

type RequestProvider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

export function qorexPresent(): boolean {
  return isQorexInstalled();
}

/** QoreX shows the send and sets the fee. It does not sign an escrow release. */
export async function fundFromQorex(toCosmos: string, uqor: bigint): Promise<{ hash: string; code: number }> {
  const native = getQorexNative();
  if (!native) throw new Error("QoreX is not installed.");
  if (!hasCapability(native, "signAndBroadcast")) {
    throw new Error("This QoreX cannot send a transaction yet.");
  }
  await native.enable(CHAIN);
  const key = await native.getKey(CHAIN);
  const value = MsgSend.encode({
    fromAddress: key.bech32Address,
    toAddress: toCosmos,
    amount: [{ denom: "uqor", amount: uqor.toString() }],
  }).finish();
  const result = await qorexSignAndBroadcast({
    chainId: CHAIN,
    messages: [{ typeUrl: MsgSend.typeUrl, value }],
  });
  if (result.code !== 0) throw new Error(`QoreX reported code ${result.code}.`);
  return { hash: result.txHash, code: result.code };
}

export async function qorexAddress(): Promise<string | null> {
  const native = getQorexNative();
  if (!native) return null;
  await native.enable(CHAIN);
  const key = await native.getKey(CHAIN);
  return key.bech32Address;
}

/** MetaMask can add the testnet. It cannot make the ML-DSA-87 signature, so it does not sign a release. */
export async function addMetaMask(): Promise<string> {
  const ethereum = (globalThis as { ethereum?: RequestProvider }).ethereum;
  if (!ethereum) throw new Error("MetaMask is not installed.");
  await addQoreEvmToWallet(ethereum, { rpcUrl: RPC, evmChainId: 9800, testnet: true });
  const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("MetaMask did not return an account.");
  return address;
}
