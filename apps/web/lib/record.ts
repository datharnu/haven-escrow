export type Outcome = "paid" | "refused" | "held";

export type Step = {
  id: string;
  title: string;
  sentence: string;
  outcome: Outcome;
  error?: string;
  hash?: string;
  who: string;
  submitted: string;
  amount: string;
  cannot: string;
};

export type Scene = {
  id: string;
  index: string;
  title: string;
  escrow: "A" | "B";
  summary: string;
  steps: Step[];
};

export const RECORDED = "20 November 2026";
export const NETWORK = "qorechain-diana";

export const PARTIES = {
  client: {
    role: "Client",
    evm: "0xB911fD43FC85826947d1E11084e594f8b9D466bf",
    cosmos: "qor1hygl6sluskpxj373uyggfev5lzuage4l69zv9q",
  },
  freelancer: {
    role: "Freelancer",
    evm: "0x4D0D492100220F97d07fEa68612fee70ff037764",
    cosmos: "qor1f5x5jggqyg8e05rlaf5xztlwwrlsxamy9j2pxw",
  },
} as const;

export const ESCROWS = {
  A: "0xE22ff1Cd5d4B9a496C68FeD4946f2cE1dd8954Bd",
  B: "0xffd1a9375Ab108Ebe0E439574b5e1D7aA050121A",
} as const;

export const SCENES: Scene[] = [
  {
    id: "release",
    index: "01",
    title: "A normal release",
    escrow: "A",
    summary: "The client released milestone 0. One fUSD went to the freelancer named at creation.",
    steps: [
      {
        id: "deliver-0",
        title: "Deliver milestone 0",
        sentence: "The freelancer delivered the file. The chain stored the commitment, not the file.",
        outcome: "held",
        hash: "0xd161906d3089aa0590d8bf031852abf611c103f8ccd6d30403e95a192971d9be",
        who: "Freelancer, ML-DSA-87",
        submitted: "Freelancer",
        amount: "Held. Nothing paid yet.",
        cannot: "The delivery cannot name a new recipient.",
      },
      {
        id: "release-0",
        title: "Release milestone 0",
        sentence: "The client released it. 1.000000 fUSD went to the freelancer.",
        outcome: "paid",
        hash: "0x2ef9eac1ad5f785e5ac8f984445b8a19977a01e6482ee1032d176cd4bbf1898a",
        who: "Client, ML-DSA-87",
        submitted: "Client",
        amount: "1.000000 fUSD to the freelancer",
        cannot: "The release cannot pay any other address.",
      },
      {
        id: "relay-deliver",
        title: "A relayer submits the next delivery",
        sentence: "Spike submitted milestone 1. Spike did not sign it. The freelancer's signature did.",
        outcome: "held",
        hash: "0xfaaf878f74237747f26e6994bd45db51ac457f74b0709ca313e15c98fde4a978",
        who: "Freelancer, ML-DSA-87",
        submitted: "Spike, who is not a party",
        amount: "Held. Milestone 1 stays in the escrow.",
        cannot: "Being the sender does not make Spike the signer.",
      },
    ],
  },
  {
    id: "classical",
    index: "02",
    title: "The classical key",
    escrow: "A",
    summary: "The same secp256k1 key could not move the 1.000000 fUSD still held for milestone 1.",
    steps: [
      {
        id: "no-window",
        title: "No window",
        sentence: "The node refused the release before broadcast. No transaction exists.",
        outcome: "refused",
        error: "no open EVM authorisation window",
        who: "Client's classical key",
        submitted: "Not sent",
        amount: "0. The balance stayed 1.000000 fUSD.",
        cannot: "A classical key cannot open the window.",
      },
      {
        id: "classical-open",
        title: "A classical open",
        sentence: "Opening the window without the hybrid signature was refused. Code 20.",
        outcome: "refused",
        error: "hybrid PQC signature required",
        who: "Client's classical key",
        submitted: "Not sent",
        amount: "0. No window was opened, so none was closed.",
        cannot: "The account has a registered ML-DSA key, so a classical open is not accepted.",
      },
      {
        id: "junk",
        title: "A junk signature",
        sentence: "Inside a window the real client had opened, a junk signature was refused.",
        outcome: "refused",
        error: "SignatureInvalid",
        hash: "0x23d8d74315ded0ce5aa1cd19c820ffecfaa164bf1bd3ca32f08b2be81699fd9b",
        who: "Not a valid ML-DSA-87 signature",
        submitted: "The classical key",
        amount: "0. Balance unchanged at 1.000000 fUSD.",
        cannot: "The window lets the call in. It does not make the signature valid.",
      },
      {
        id: "replay",
        title: "The old signature, on the next milestone",
        sentence: "The milestone 0 release signature was replayed as a release of milestone 1.",
        outcome: "refused",
        error: "SignatureInvalid",
        hash: "0xed3dcf05267a9ecddb4316fb615c5509e3f3e5df879f00d9e3320be389fd75d9",
        who: "Client's earlier ML-DSA signature, wrong action",
        submitted: "The classical key",
        amount: "0. Balance unchanged at 1.000000 fUSD.",
        cannot: "A signature over milestone 0 does not release milestone 1.",
      },
      {
        id: "cancel",
        title: "Cancel after delivery",
        sentence: "Cancel of a delivered milestone stops on the status, before the signature is read.",
        outcome: "refused",
        error: "WrongStatus",
        hash: "0x17fc1668ac8125d0cf5e05fee09875d4fc4578de656baba7ca3673cea86f3b8b",
        who: "Not checked. The milestone is already Delivered.",
        submitted: "The classical key",
        amount: "0. Balance unchanged at 1.000000 fUSD.",
        cannot: "A delivered milestone cannot be cancelled. The checks were not reordered to hide this.",
      },
    ],
  },
  {
    id: "dispute",
    index: "03",
    title: "Two arbiters",
    escrow: "A",
    summary: "One arbiter was short. Two signed 70% to the freelancer and 30% back to the client.",
    steps: [
      {
        id: "dispute",
        title: "The client disputes milestone 1",
        sentence: "The dispute stops the automatic release. No split is chosen yet.",
        outcome: "held",
        hash: "0x7d1d63d40abce0ae8007f7277d262f146958e124a6b86ba173ad48510aa6f463",
        who: "Client, ML-DSA-87",
        submitted: "Client",
        amount: "Held. 1.000000 fUSD still in escrow A.",
        cannot: "A dispute cannot name a new recipient.",
      },
      {
        id: "one-arbiter",
        title: "One arbiter",
        sentence: "A resolve signed only by arbiter 1 was refused.",
        outcome: "refused",
        error: "TooFew",
        hash: "0x4c3a8a79bb9bc95b0f29a7c2401917f160200f01df994478f36fb384785f5c42",
        who: "Arbiter 1 alone",
        submitted: "Arbiter 3",
        amount: "0 moved.",
        cannot: "One arbiter is under the threshold of two.",
      },
      {
        id: "two-arbiters",
        title: "Two arbiters, 7000 bps",
        sentence: "Arbiter 1 and arbiter 2 signed. The freelancer received 0.700000 fUSD. The client received 0.300000.",
        outcome: "paid",
        hash: "0xd1fd4cac9a1565ee665df65d9d5f239e98ec72ec8fc9d25df7ce8099f079a448",
        who: "Arbiter 1 and arbiter 2, ML-DSA-87",
        submitted: "Arbiter 3, who did not need to be one of the signers",
        amount: "0.700000 fUSD to the freelancer, 0.300000 fUSD to the client",
        cannot: "They could have signed any split. Two arbiters who agree are not stopped.",
      },
    ],
  },
  {
    id: "timeout",
    index: "04",
    title: "The review runs out",
    escrow: "B",
    summary: "Escrow B's review was 120 seconds. Early release was refused. After the chain passed it, the freelancer was paid.",
    steps: [
      {
        id: "deliver-b",
        title: "Deliver escrow B",
        sentence: "The freelancer delivered the only milestone. The review started.",
        outcome: "held",
        hash: "0x40735fcf9943cd77ff5bd24ab4541ef8f6f92b47107d0fb9e58b803825c8d37f",
        who: "Freelancer, ML-DSA-87",
        submitted: "Freelancer",
        amount: "Held. 1.000000 fUSD in escrow B.",
        cannot: "Delivery does not pay.",
      },
      {
        id: "too-early",
        title: "Before the review ends",
        sentence: "autoRelease during the 120 seconds was refused. The script did not warp the clock.",
        outcome: "refused",
        error: "TooEarly",
        hash: "0xd06ae211608d06ce12fa1810d21e946ce667067794569772e4c9ab7174507d87",
        who: "No new signature. The timeout is not due.",
        submitted: "Spike",
        amount: "0 moved.",
        cannot: "The exact boundary still belongs to the review. One second later, it does not.",
      },
      {
        id: "auto",
        title: "After the review",
        sentence: "The same call paid the freelancer 1.000000 fUSD. No new signature.",
        outcome: "paid",
        hash: "0xf542a066e48d104fabcde058661775ccb3d3c9c6b538d7b52d97f1bb991cd558",
        who: "Nobody. The review period stored at creation had passed.",
        submitted: "Spike",
        amount: "1.000000 fUSD to the freelancer",
        cannot: "The timeout cannot pay anyone but the freelancer named at creation.",
      },
    ],
  },
];

export function shortHash(hash: string): string {
  const body = hash.startsWith("0x") ? hash.slice(2) : hash;
  return `${hash.slice(0, 2) === "0x" ? "0x" : ""}${body.slice(0, 8)}…${body.slice(-4)}`;
}

export function findStep(query: string): { scene: Scene; step: Step } | null {
  const needle = query.trim().toLowerCase().replace(/^0x/, "");
  if (needle.length < 6) return null;
  for (const scene of SCENES) {
    for (const step of scene.steps) {
      if (!step.hash) continue;
      const body = step.hash.toLowerCase().replace(/^0x/, "");
      if (body.startsWith(needle) || body.includes(needle)) return { scene, step };
    }
  }
  return null;
}
