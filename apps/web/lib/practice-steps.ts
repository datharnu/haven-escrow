export function stepState(
  deal: { escrow?: string; receipt?: unknown; delivered?: boolean },
  side: "client" | "freelancer",
  step: "receipt" | "deliver",
): string {
  if (!deal.escrow) return "Create the escrow first.";
  if (deal.delivered) return "Landed.";
  if (!deal.receipt) {
    if (side === "freelancer") return "Switch to the client.";
    return step === "receipt" ? "Now. Receipt this file." : "Waiting for the receipt.";
  }
  if (step === "receipt") return "Landed.";
  return side === "freelancer" ? "Now. Deliver this file." : "Switch to the freelancer.";
}
