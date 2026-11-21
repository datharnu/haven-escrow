import type { Role } from "./practice";

const KEY = "haven-escrow-practice";

export type SavedReceipt = {
  conversationId: string;
  counter: number;
  ciphertextHash: string;
  commitment: string;
  recordHash: string;
};

export type SavedDeal = {
  phrases: Record<Role, string>;
  copied: boolean;
  escrow?: string;
  releaseSignature?: string;
  receipt?: SavedReceipt;
  delivered?: boolean;
};

function words(value: string): boolean {
  return value.trim().split(/\s+/).length === 12;
}

function word32(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function receiptOk(receipt: SavedReceipt): boolean {
  return (
    receipt.counter === 0 &&
    word32(receipt.conversationId) &&
    word32(receipt.ciphertextHash) &&
    word32(receipt.commitment) &&
    word32(receipt.recordHash) &&
    receipt.conversationId.toLowerCase() !== "0xee9e929e97f3b026bd1c537e98d628c60005d8d522b74a4104d94055012cb714" &&
    receipt.recordHash.toLowerCase() !== "0x3dfdb6bdf8a11a81792129083642f706a9b4547a62d4d8ebbe3eceb645566a89"
  );
}

export function loadDeal(): SavedDeal | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SavedDeal;
    const roles: Role[] = ["client", "freelancer", "arbiter-1", "arbiter-2", "arbiter-3"];
    if (!parsed.phrases || roles.some((role) => !words(parsed.phrases[role] ?? ""))) return null;
    if (parsed.receipt && !receiptOk(parsed.receipt)) delete parsed.receipt;
    if (parsed.delivered !== true) delete parsed.delivered;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDeal(deal: SavedDeal): void {
  localStorage.setItem(KEY, JSON.stringify(deal));
}

export function forgetDeal(): void {
  localStorage.removeItem(KEY);
}
