# Kits and libraries

Versions are the pins in `package.json` and `apps/web/package.json`. A file path is an import in this repository. A hash is a recorded transaction. A test is a file that runs without the chain.

## QoreChain kits

| Package | Version | File | Evidence |
| --- | --- | --- | --- |
| `@qorechain/sdk` | 0.14.0 | `scripts/lib/chain.ts` imports `EthNativeSigner`, `openEvmWindowMsg`, `closeEvmWindowMsg`, `fetchEvmWindow`, and `deriveUnifiedAccount`. `apps/web/lib/practice-chain.ts` imports the same pieces for `/practice`. The practice hashes are in `deployments/practice.json`. | Scoped fund window `41C8F14CA27D1CC02372654C9414F2497E8D686D3B1C20A494D743D04A9AE3F2` in `deployments/fund-client.json` |
| `@qorechain/evm` | 0.14.0 | `scripts/lib/chain.ts` and `scripts/spike.ts` import `evmWindowCost` and `weiToUqorCeil`. The chain object is not taken from this package. `lib/haven-pq-kit/src/ts/network.ts` defines chain id 9800 because this package's chain object does not typecheck against viem 2.47.6 | Same fund window as the row above. Spike create-inside-a-window `0xa0021315f5db9a2fd875749e20412914563fbadc681ab3da3deada90716dc2e0` in `deployments/spikes.json` |
| `@qorechain/pqc` | 0.2.3 | `apps/web/lib/verify.ts` and `test/ts/escrow.test.ts` import `mldsa87`. The page calls `mldsa87.verify`. It does not load WebAssembly | Browser check of resolve `0xd1fd4cac9a1565ee665df65d9d5f239e98ec72ec8fc9d25df7ce8099f079a448`, recorded in the README on 21 November 2026. `test/ts/escrow.test.ts` checks the same message bytes with no chain |
| `@qorechain/qoreseal` | 0.1.0 | `src/ts/deliverable.ts` imports `seal` and `open`. `apps/web/lib/practice-seal.ts` seals one practice file the same way and discards the keys. `scripts/lib/live.ts` reads a `RecipientCard` from `cards/` and checks it against the local ML-KEM key | `test/ts/deliverable.test.ts` opens a file for the client and for every pair of arbiters, and refuses one share. Scene 3 recorded `opened.oneShareRefused: true` and plaintext hash `0x7e222e76abe477c5b480f1381f2af9eb0ed84563292168a1da73c17465b82360` in `deployments/scene-3-dispute.json`. The practice receipt hash is in `deployments/practice.json`. Courier did not carry the file. |
| `@qorechain/qoresign` | 0.1.0 | No file under `src/`, `scripts/`, `test/`, or `apps/` imports it. `lib/haven-pq-kit/scripts/register.ts` imports `classicalKeyFromPrivate` to sign a recipient card. `scripts/fund-account.ts` tells the operator to create the account with that kit's CLI | Public cards in `cards/`. The client card `cards/qor1hygl6sluskpxj373uyggfev5lzuage4l69zv9q.json` is `ml-dsa-87-hybrid` with classical key type `eth_secp256k1`, issued 20 November 2026 |
| `@qorechain/mcp` | 0.1.1 | `scripts/evidence.ts` calls the `get_transaction` and `get_pq_status` tools in-process | The README records `npm run evidence` as 68 passed and 0 failed on 20 November 2026. On 21 November 2026 it printed 73 passed and 0 failed. |
| `@qorechain/qorescan` | 0.1.0 | `scripts/cbom.ts` runs `node_modules/.bin/qorescan` and refuses any contract cryptography outside Keccak and ML-DSA through `pqcVerify` or `pqcKeyStatus` | `npm run cbom:check` is the CI step in `.github/workflows/test.yml`. The README records a local pass on 21 November 2026 |
| `haven-pq-kit` | v0.1.0, submodule `9fe7ac289f512e39bce6a2d5e31baeb98195519c` | `src/HavenEscrow.sol` uses `PqAuth` and `PqQuorum`. `src/ts/escrow.ts` imports `encodeAuthMessage`, `signAuth`, `quorumAction`, and `signQuorumShares` | Release `0x2ef9eac1ad5f785e5ac8f984445b8a19977a01e6482ee1032d176cd4bbf1898a`. `test/Vectors.t.sol` checks `vectors/escrow.json` against `EscrowArgs` |

`VendorSig` is in the kit. Haven Escrow does not import it. Steward's PayGate does. That is a different repository.

## Network features

| Feature | File | Evidence |
| --- | --- | --- |
| Scoped EVM window | `scripts/spike.ts`, `scripts/rehearse.ts`, `scripts/fund-client.ts`, through `@qorechain/sdk` | No window and a classical open were refused before broadcast. `deployments/scene-2-rehearse.json` stores the text and no hash for those two. A contract created inside a scoped window is `0xa0021315f5db9a2fd875749e20412914563fbadc681ab3da3deada90716dc2e0` in `deployments/spikes.json` |
| `pqcVerify` at `0x…0a01` | `lib/haven-pq-kit/src/PqAuth.sol` `PQC_VERIFY`. `authorize` is the path for deliver, release, dispute, and cancel. `PqQuorum` is the path for resolve | Spike replay of `ping` reverted `SignatureInvalid` at `0xd5634f54f8673f85fc30db6be66571e283c8e0c247ffaf3d293cfb87551830ac` |
| `pqcKeyStatus` at `0x…0a02` | `lib/haven-pq-kit/src/PqAuth.sol` `PQC_STATUS`. The constructor asks it for all five parties. The page reads it in `apps/web/lib/verify.ts` | Spike deploy `0xac057fd48140b66e250f248bb0e4035820d8679e1629bdfd42f964cd333ee358`. `SpikeTarget` is not an escrow |
| ML-KEM key registry | `src/ts/deliverable.ts` calls `readVerifiedKemKey` from `haven-pq-kit/keydir`, which reads the registry and checks the card. The file never reads a KEM key from REST by itself | Scene 3 open, hash of the plaintext above. One share was refused before any resolve transaction |
| Faucet fUSD | `scripts/fund-client.ts` converts a faucet claim. It does not swap | `MsgConvertCoin` `9270876CBEF1759C772B7DA3E77C3D5915F6FF6178A68435D5AFFB067C59FBFF`. fUSD `0x97143B771D34ddb9130b807b135Ae675A5a963CA` |

## Not used, and why

- `@qorechain/qore-cli`. It is not in `package.json`. `npm run evidence` calls MCP in-process.
- `create-qorechain-dapp`. It is not in `package.json`.
- `@qorechain/wallet-adapter` 0.6.0 and `@qorechain/qorex-types` 0.1.0 are in `apps/web/package.json`. `apps/web/lib/practice-wallet.ts` uses `addQoreEvmToWallet` to add chain 9800, and `qorexSignAndBroadcast` to send test QOR. QoreX does not answer `eth_sendTransaction`. Neither wallet signs an escrow release. `/record` still sends nothing.
- A contract call from HavenEscrow to Steward or Courier. `src/` does not name PayGate, MemoPay, PrekeyDirectory, or DeliveryReceipts. The practice page recorded one receipt for a file it sealed itself, in `deployments/practice.json`. Courier did not carry that file. It then carried a second file. The page read `receipt()` on DeliveryReceipts `0x06b52afc4a151b0efa260e2adcdf2d477632cb56` and the ciphertext hash matched. HavenEscrow does not read that contract. Those hashes are in `deployments/courier-pays.json`.
