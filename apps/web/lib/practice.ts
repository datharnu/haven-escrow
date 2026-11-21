import { getAddress, type Address } from "viem";

/** The factory already on testnet. The page does not deploy another. */
export const FACTORY = getAddress("0xf30bfc219987E60e849D5cF9e7351b7380eEc09B");
export const FUSD = getAddress("0x97143B771D34ddb9130b807b135Ae675A5a963CA");
export const FUSD_DENOM = `erc20:${FUSD}`;

/** One milestone. 100000 base units is 0.1 fUSD. */
export const PRACTICE_AMOUNT = 100_000n;
/** The short review Escrow B used, so a visit can see TooEarly and then the release. */
export const REVIEW_SECONDS = 120;
/** The silent-panel split recorded in the README. */
export const DEFAULT_SPLIT_BPS = 5000;

/** The fee the scene scripts send. It is not lowered. */
export const NATIVE_FEE = { amount: [{ denom: "uqor", amount: "180000" }], gas: "1200000" } as const;

/** Window value caps from `scripts/lib/chain.ts`. A cost above 66% of the cap stops. */
export const WINDOW_CAP = { deploy: 5_000_000n, call: 2_000_000n, resolve: 3_000_000n } as const;
export type WindowKind = keyof typeof WINDOW_CAP;

export const ROLES = ["client", "freelancer", "arbiter-1", "arbiter-2", "arbiter-3"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Project accounts and the recorded contracts. A practice identity that lands
 * on one of these is discarded. Spike's account is the sender of the public
 * funding transaction in `deployments/accounts.json`.
 */
const FORBIDDEN = [
  "0xB911fD43FC85826947d1E11084e594f8b9D466bf",
  "0x4D0D492100220F97d07fEa68612fee70ff037764",
  "0x55937e32E4B3Bd62a49CB7726fB64E7f9AAd945C",
  "0x00fb3E9Bf1A0cb4DF325010004a59722f0c6a248",
  "0xf81E6299CeC4E0Cf16Fd5D014D13083DeEc61065",
  "0xE22ff1Cd5d4B9a496C68FeD4946f2cE1dd8954Bd",
  "0xffd1a9375Ab108Ebe0E439574b5e1D7aA050121A",
  FACTORY,
  "0xe11fe2bb1ad13ab116e0d362b218ef1b2330b1a7",
  "0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396",
  "0x9C3876f2033552D5293e6efcAdFED87BfEB7E6be",
  "0xf09cc23e992A4591A456836D7223655399D0BB90",
  "0x5f704d258733e4cc8a776ec8306144c84f1ebacf",
].map((address) => getAddress(address));

const forbidden = new Set(FORBIDDEN.map((address) => address.toLowerCase()));

export function isForbidden(address: string): boolean {
  return forbidden.has(address.toLowerCase());
}

export function sortAddresses(addresses: readonly Address[]): Address[] {
  return [...addresses].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
}

export type PracticeTerms = {
  client: Address;
  freelancer: Address;
  token: Address;
  arbiters: [Address, Address, Address];
  reviewPeriod: bigint;
  arbiterTimeout: bigint;
  defaultSplitBps: number;
  amounts: [bigint];
  deadlines: [bigint];
};

/** The create arguments. No field here is a payee other than the two names. */
export function practiceTerms(input: {
  client: Address;
  freelancer: Address;
  arbiters: readonly [Address, Address, Address];
  now: bigint;
}): PracticeTerms {
  if (input.client.toLowerCase() === input.freelancer.toLowerCase()) {
    throw new Error("The client and the freelancer are the same address.");
  }
  const arbiters = sortAddresses(input.arbiters) as [Address, Address, Address];
  for (const arbiter of arbiters) {
    if (arbiter.toLowerCase() === input.client.toLowerCase() || arbiter.toLowerCase() === input.freelancer.toLowerCase()) {
      throw new Error("An arbiter is one of the two names. The contract refuses that.");
    }
  }
  return {
    client: input.client,
    freelancer: input.freelancer,
    token: FUSD,
    arbiters,
    reviewPeriod: BigInt(REVIEW_SECONDS),
    arbiterTimeout: BigInt(REVIEW_SECONDS),
    defaultSplitBps: DEFAULT_SPLIT_BPS,
    amounts: [PRACTICE_AMOUNT],
    deadlines: [input.now + 86_400n],
  };
}

export function assertUnderCap(kind: WindowKind, uqor: bigint, label: string): void {
  const cap = WINDOW_CAP[kind];
  const limit = (cap * 66n) / 100n;
  if (uqor > limit) throw new Error(`${label} would reserve ${uqor} uqor, above 66% of the ${cap} uqor cap.`);
}

/** The gas `scripts/lib/live.ts` reserves for a call that is already known to revert. */
export const REFUSAL_GAS = 1_500_000n;

/** `PqAuth.SIG_LEN`. A shorter signature reverts `BadSignatureLength` before `SignatureInvalid`. */
export const SIGNATURE_BYTES = 4627;

/** QOR to ask QoreX for: the create window, four call windows, and one native fee for each of the five identities. */
export function suggestedQor(): bigint {
  return WINDOW_CAP.deploy + WINDOW_CAP.call * 4n + 180_000n * 5n;
}
