import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import { SCENES } from "./record";
import milestone0 from "./sealed/0xfa3c3d6b2fcc89da2806587392970eb17794f63b2f609a7fafdeb4074825bffd.json";
import milestone1 from "./sealed/0xa5648e81553bd346c427c0cf7929c172a4d560ba8251e16240b61a4ba2d553af.json";
import escrowB from "./sealed/0xc43688aab45fe927513b0f74257f8be5a1f99480e9c62c1cf0c6f73fe7296e63.json";

type RawManifest = {
  escrow: string;
  milestone: string;
  fileName: string;
  ciphertext: string;
  clientEnvelope: string;
  arbiterEnvelopes: string[];
};

function asHex(value: string, label: string): Hex {
  if (!value.startsWith("0x")) throw new Error(`${label} is not hex.`);
  return value as Hex;
}

/** The same eight fields `commitmentOf` hashes in `src/ts/deliverable.ts`. Not a file key. */
export function commitmentOf(manifest: {
  escrow: Address;
  milestone: bigint;
  ciphertext: Hex;
  clientEnvelope: Hex;
  arbiterEnvelopes: readonly [Hex, Hex, Hex];
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        manifest.escrow,
        manifest.milestone,
        keccak256(manifest.ciphertext),
        keccak256(manifest.clientEnvelope),
        keccak256(manifest.arbiterEnvelopes[0]),
        keccak256(manifest.arbiterEnvelopes[1]),
        keccak256(manifest.arbiterEnvelopes[2]),
      ],
    ),
  );
}

export type SealedFile = {
  escrow: Address;
  milestone: bigint;
  fileName: string;
  commitment: Hex;
  deliverHash: Hex;
  envelopes: [Hex, Hex, Hex];
};

function stepHash(sceneId: string, stepId: string): Hex {
  const hash = SCENES.find((scene) => scene.id === sceneId)?.steps.find((step) => step.id === stepId)?.hash;
  if (!hash) throw new Error(`The record has no hash for ${sceneId} ${stepId}.`);
  return hash as Hex;
}

function published(raw: RawManifest, deliverHash: Hex): SealedFile {
  if (raw.arbiterEnvelopes.length !== 3) throw new Error(`${raw.fileName} does not have three envelopes.`);
  const envelopes = raw.arbiterEnvelopes.map((item) => asHex(item, raw.fileName)) as [Hex, Hex, Hex];
  const manifest = {
    escrow: getAddress(raw.escrow),
    milestone: BigInt(raw.milestone),
    ciphertext: asHex(raw.ciphertext, raw.fileName),
    clientEnvelope: asHex(raw.clientEnvelope, raw.fileName),
    arbiterEnvelopes: envelopes,
  };
  return {
    escrow: manifest.escrow,
    milestone: manifest.milestone,
    fileName: raw.fileName,
    commitment: commitmentOf(manifest),
    deliverHash,
    envelopes: [keccak256(envelopes[0]), keccak256(envelopes[1]), keccak256(envelopes[2])],
  };
}

const escrowA0 = published(milestone0, stepHash("release", "deliver-0"));
const escrowA1 = published(milestone1, stepHash("release", "relay-deliver"));

/** Escrow B's file. The panel does not show it. The test checks the commitment anyway. */
export const escrowBFile = published(escrowB, stepHash("timeout", "deliver-b"));

export function filesForScene(sceneId: string): SealedFile[] {
  if (sceneId === "release") return [escrowA0, escrowA1];
  if (sceneId === "dispute") return [escrowA1];
  return [];
}

export const TWO_ARBITER_HASH = stepHash("dispute", "two-arbiters");
