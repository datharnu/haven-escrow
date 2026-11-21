import type { Hex } from "viem";
import { CallError, EVM_RPC, NetworkError, type Rpc } from "./verify";

/** Reads the public EVM RPC. A failed fetch is a network error. A revert with `data` is a CallError. */
export function browserRpc(): Rpc {
  return async (method, params) => {
    let response: Response;
    try {
      response = await fetch(EVM_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    } catch {
      throw new NetworkError();
    }
    if (!response.ok) throw new NetworkError();
    let body: { result?: unknown; error?: { message?: string; data?: unknown } };
    try {
      body = (await response.json()) as { result?: unknown; error?: { message?: string; data?: unknown } };
    } catch {
      throw new NetworkError();
    }
    if (body.error) {
      const data = typeof body.error.data === "string" && body.error.data.startsWith("0x") ? (body.error.data as Hex) : undefined;
      throw new CallError(body.error.message ?? "The testnet refused the read.", data);
    }
    return body.result ?? null;
  };
}
