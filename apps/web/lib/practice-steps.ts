export type NextPrimary =
  | "faucet"
  | "register"
  | "pass"
  | "create"
  | "convert"
  | "client"
  | "freelancer"
  | "receipt"
  | "deliver"
  | "release"
  | "resolve"
  | null;

export type NextStep = { text: string; primary: NextPrimary; fund: "start" | "more" | "fusd" | null };

export type NextInput = {
  phase: "reading" | "ready" | "error";
  clientUqor: bigint | null;
  /** Freelancer, then the three panel keys, in that order. */
  otherUqor: readonly bigint[];
  registered: Partial<Record<"client" | "freelancer" | "arbiter-1" | "arbiter-2" | "arbiter-3", boolean>> | null;
  escrow: boolean;
  fusd: bigint | null;
  milestone: number | null;
  receipt: boolean;
  side: "client" | "freelancer";
};

const FEE = 180_000n;
const PASS_NEED = 2_000_000n * 4n + FEE;
const FUSD_NEED = 100_000n;
const OTHERS = ["freelancer", "arbiter-1", "arbiter-2", "arbiter-3"] as const;
const STATUS = ["Unfunded", "Funded", "Delivered", "Released", "Disputed", "Resolved", "Refunded", "Cancelled"];

const reading = { text: "Reading the deal.", primary: null, fund: null } as const;

/** The one thing a judge should do next. Balances and the milestone decide it. */
export function nextStep(input: NextInput): NextStep {
  if (input.clientUqor !== null && input.clientUqor < FEE) {
    return { text: "Fund the client from the faucet.", primary: "faucet", fund: "start" };
  }
  if (input.phase === "error") return { text: "Couldn't read the deal. Use Check again.", primary: null, fund: null };
  if (input.phase === "reading" || input.clientUqor === null || input.registered === null) return reading;
  if (typeof input.registered.client !== "boolean") return reading;
  if (!input.registered.client) return { text: "Register the client.", primary: "register", fund: null };
  if (input.otherUqor.length !== 4 || OTHERS.some((role) => typeof input.registered?.[role] !== "boolean")) return reading;
  const needsPass = OTHERS.some((role, index) => !input.registered?.[role] && input.otherUqor[index] < FEE);
  if (needsPass) {
    if (input.clientUqor < PASS_NEED) {
      return {
        text: "Fund the client with more test QOR. The pass sends 2000000 uqor to each of the other four.",
        primary: "faucet",
        fund: "more",
      };
    }
    return { text: "Pass 2000000 uqor to each other identity.", primary: "pass", fund: null };
  }
  if (OTHERS.some((role) => !input.registered?.[role])) {
    return { text: "Register the freelancer and the panel.", primary: "register", fund: null };
  }
  if (!input.escrow) return { text: "Create the escrow.", primary: "create", fund: null };
  if (input.milestone === null || input.fusd === null) return reading;
  if (input.milestone === 0) {
    if (input.fusd < FUSD_NEED) {
      return { text: "Get 0.1 fUSD from the faucet, then convert and fund.", primary: "faucet", fund: "fusd" };
    }
    if (input.side !== "client") return { text: "Switch to the client, then convert 0.1 fUSD and fund.", primary: "client", fund: null };
    return { text: "Convert 0.1 fUSD and fund.", primary: "convert", fund: null };
  }
  if (input.milestone === 1 && !input.receipt) {
    if (input.side !== "client") return { text: "Switch to the client, then receipt the sealed file.", primary: "client", fund: null };
    return { text: "Receipt the sealed file.", primary: "receipt", fund: null };
  }
  if (input.milestone === 1) {
    if (input.side !== "freelancer") {
      return { text: "Switch to the freelancer, then deliver the sealed file.", primary: "freelancer", fund: null };
    }
    return { text: "Deliver the sealed file.", primary: "deliver", fund: null };
  }
  if (input.milestone === 2) {
    if (input.side !== "client") {
      return { text: "Switch to the client. Release, or dispute during the 120 second review.", primary: "client", fund: null };
    }
    return { text: "Release, or dispute during the 120 second review.", primary: "release", fund: null };
  }
  if (input.milestone === 4) return { text: "Resolve 50/50. Two panel keys sign.", primary: "resolve", fund: null };
  return { text: `The milestone is ${STATUS[input.milestone] ?? "finished"}.`, primary: null, fund: null };
}

/** The receipt and deliver cards follow the same next step, so they do not say Now too early. */
export function guideStep(local: string, primary: NextPrimary, step: "receipt" | "deliver"): string {
  if (!local.startsWith("Now.")) return local;
  if (step === "receipt" && primary === "receipt") return local;
  if (step === "deliver" && primary === "deliver") return local;
  return step === "receipt" ? "Waiting until the earlier steps are done." : "Waiting until the escrow is funded.";
}

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
