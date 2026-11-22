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

function qorexSendError(error: unknown, uqor: bigint): Error {
  const message = error instanceof Error ? error.message : "";
  if (/\(code 5\)|insufficient funds/i.test(message)) {
    return new Error(
      `QoreX does not have enough QOR to send ${uqor.toString()} uqor. Fund the QoreX account from the faucet, or lower the amount.`,
    );
  }
  return error instanceof Error ? error : new Error("QoreX could not send.");
}

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
  let result: { txHash: string; code: number };
  try {
    result = await qorexSignAndBroadcast({
      chainId: CHAIN,
      messages: [{ typeUrl: MsgSend.typeUrl, value }],
    });
  } catch (error) {
    throw qorexSendError(error, uqor);
  }
  if (result.code === 5) throw qorexSendError(new Error("Transaction failed on-chain (code 5)."), uqor);
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
