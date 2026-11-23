/**
 * The receipt-evidence scene report, and the smaller copy the web app ships at apps/web/lib/receipt-gate.json.
 * Pure: no chain, no keys. `test/ts/gate-record.test.ts` keeps the web copy equal to `webRecord(report)`.
 */
import type { Address, Hex } from "viem";

export const SCENE6_REPORT = "deployments/scene-6-receipt-gate.json";
export const WEB_RECORD = "apps/web/lib/receipt-gate.json";

export type GateStep = {
  id: string;
  title: string;
  outcome: "paid" | "refused" | "held";
  error?: string;
  hash: string;
  who: string;
};

export type Scene6Report = {
  network: string;
  ranAt?: string;
  ok: boolean;
  escrowD?: Address;
  factory?: Address;
  deliveryReceipts?: Address;
  client?: Address;
  freelancer?: Address;
  carol?: Address;
  arbiterTimeout?: string;
  deliverable?: string;
  commitment?: Hex;
  parts?: Hex[];
  conversationId?: Hex;
  receivedAt?: string;
  disputedAt?: string;
  recordedAt?: string;
  freelancerBefore?: string;
  freelancerDelta?: string;
  clientBefore?: string;
  clientDelta?: string;
  steps: GateStep[];
  transactions: { hash: string; tier: "pqc" | "enrollment" | "classical" | "refused"; note: string }[];
};

export type WebGateRecord = {
  recorded: string;
  network: string;
  escrow: Address;
  factory: Address;
  deliveryReceipts: Address;
  client: Address;
  freelancer: Address;
  commitment: Hex;
  conversationId: Hex;
  arbiterTimeout: string;
  disputedAt: string;
  receivedAt: string;
  recordedAt: string;
  paidToFreelancer: string;
  paidToClient: string;
  steps: GateStep[];
};

/** `null` until the scene has finished with `ok: true`. */
export function webRecord(report: Scene6Report | null): WebGateRecord | null {
  if (!report || !report.ok) return null;
  const need = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) throw new Error(`scene 6 report has no ${name}`);
    return value;
  };
  return {
    recorded: need(report.ranAt, "ranAt").slice(0, 10),
    network: report.network,
    escrow: need(report.escrowD, "escrowD"),
    factory: need(report.factory, "factory"),
    deliveryReceipts: need(report.deliveryReceipts, "deliveryReceipts"),
    client: need(report.client, "client"),
    freelancer: need(report.freelancer, "freelancer"),
    commitment: need(report.commitment, "commitment"),
    conversationId: need(report.conversationId, "conversationId"),
    arbiterTimeout: need(report.arbiterTimeout, "arbiterTimeout"),
    disputedAt: need(report.disputedAt, "disputedAt"),
    receivedAt: need(report.receivedAt, "receivedAt"),
    recordedAt: need(report.recordedAt, "recordedAt"),
    paidToFreelancer: need(report.freelancerDelta, "freelancerDelta"),
    paidToClient: need(report.clientDelta, "clientDelta"),
    steps: report.steps,
  };
}
