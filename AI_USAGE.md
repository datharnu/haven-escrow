# How this was written

21 November 2026. The facts below are the git history and the documents in this repository. Where a commit does not name a model, this note does not invent one.

## Workflow

| Commit | Date | What it added |
| --- | --- | --- |
| `6343063` | 20 November 2026 | The Apache-2.0 licence |
| `cf32f6a` | 20 November 2026 | The contracts, the client, and the four testnet scenes |
| `24fc680` | 21 November 2026 | The juror README and the two audit reports |
| `2a610e2` | 21 November 2026 | The cryptography check and the test workflow |
| `7280e84` | 21 November 2026 | The credit to qore-pq-kit |
| `4d66bf5` | 21 November 2026 | The replay site of the four scenes |
| `a55c534` | 21 November 2026 | The browser check of the recorded signatures |
| `8fda522` | 21 November 2026 | The public URL, after Verify all on the hosted site |

The five commits through `7280e84` do not name a model.

`4d66bf5`, `a55c534`, and `8fda522` were written in Cursor on 21 November 2026 by Grok 4.7. This note and `docs/kits.md` are the same session. The human imported the repository on Vercel, confirmed https://havenesc.vercel.app, and asked for that URL to be pushed.

No commit in this list sends a new testnet transaction. `scripts/deploy.ts` and the scene scripts throw `already ran` when their report has `ok: true`.

## What the human decided

- The one rule. Funds leave only to the client or the freelancer named when the escrow was created. Every release needs a fresh ML-DSA-87 signature, or a timeout those two parties already accepted. It is the first line of the README.
- `WrongStatus` stays. `deployments/scene-2-rehearse.json` records the approval on 20 November 2026: cancel of a Delivered milestone checks status before the signature, and the contract was not reordered to return `SignatureInvalid`.
- The audit score was not chased. Both PDFs score 35/100 and name functions that are not in `src/`. [docs/AUDIT.md](docs/AUDIT.md) marks each one a false positive. The source was not edited between the two runs. No `withdraw`, `admin`, or `setFee` was added.
- No swap. On 20 November 2026 pool 2 quoted less fUSD than the scenes needed. `scripts/fund-client.ts` stops with "Not swapping." `deployments/fund-client.json` records `MsgConvertCoin` `9270876CBEF1759C772B7DA3E77C3D5915F6FF6178A68435D5AFFB067C59FBFF` and no swap.
- No redeploy. The factory and both escrows in `deployments/` are the addresses the README names. A finished report throws `already ran`.

## What was checked against the chain or the source

- `npm run evidence` is recorded in the README as 68 passed and 0 failed on 20 November 2026. This note did not re-run it.
- Each audit finding was checked by searching `src/` for the function the PDF names. The map is [docs/AUDIT.md](docs/AUDIT.md).
- On 21 November 2026, Verify all on https://havenesc.vercel.app/record finished at 390px and at 1440px. The two-arbiter step verified both signatures and matched the two named recipients. That check is written in the README. It sends nothing.

## What was not checked

- `resolveTimeout` has not been called on testnet. The silent-panel path is in Foundry only.
- The explorer has no verified source. The compiler settings are in `foundry.toml`.
- There is no film.
- The browser check does not compare bytecode with the source, and it does not call `resolveTimeout`.
- The model for the commits through `7280e84` is not in the repository.
