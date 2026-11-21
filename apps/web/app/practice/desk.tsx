"use client";

import { useEffect, useState } from "react";
import { getAddress, type Address, type Hex } from "viem";
import {
  STATUS_WORD,
  accountsFrom,
  classicalWindow,
  convertAndFund,
  createEscrow,
  dealStatus,
  deliverCommitment,
  dispute,
  earlyRelease,
  makePhrases,
  passQor,
  readUqor,
  registerIdentity,
  registered,
  receiptSealedFile,
  release,
  replayRelease,
  resolveHalf,
  stealPay,
  wrongMilestone,
} from "@/lib/practice-chain";
import { NATIVE_FEE, ROLES, suggestedQor, type Role } from "@/lib/practice";
import { stepState } from "@/lib/practice-steps";
import { forgetDeal, loadDeal, saveDeal, type SavedDeal } from "@/lib/practice-store";
import { addMetaMask, fundFromQorex, qorexPresent } from "@/lib/practice-wallet";
import type { UnifiedAccount } from "@qorechain/sdk";

const FEE = NATIVE_FEE.amount[0].amount;

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function qor(uqor: bigint): string {
  const whole = uqor / 1_000_000n;
  const part = (uqor % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return part ? `${whole}.${part}` : whole.toString();
}

export function PracticeDesk() {
  const [ready, setReady] = useState(false);
  const [deal, setDeal] = useState<SavedDeal | null>(null);
  const [accounts, setAccounts] = useState<Record<Role, UnifiedAccount> | null>(null);
  const [side, setSide] = useState<"client" | "freelancer">("client");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stolen, setStolen] = useState<{ attempt: string; detail: string }[]>([]);
  const [confirm, setConfirm] = useState<{ title: string; body: string; confirm: string; run: () => Promise<void> } | null>(null);
  const [qorAmount, setQorAmount] = useState(suggestedQor().toString());
  const [balances, setBalances] = useState<Partial<Record<Role, string>>>({});
  const [onChain, setOnChain] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadDeal();
    setDeal(saved);
    setReady(true);
    if (!saved) return;
    let cancelled = false;
    void accountsFrom(saved.phrases).then((next) => {
      if (!cancelled) setAccounts(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function keep(next: SavedDeal) {
    saveDeal(next);
    setDeal(next);
  }

  async function run(label: string, work: () => Promise<void>) {
    setError(null);
    setNote(null);
    setBusy(label);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The action failed.");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  function ask(title: string, body: string, work: () => Promise<void>, confirmLabel = "Send") {
    setConfirm({ title, body, confirm: confirmLabel, run: () => run(title, work) });
  }

  async function make() {
    await run("Making the identities", async () => {
      const phrases = await makePhrases();
      const next = { phrases, copied: false };
      keep(next);
      setAccounts(await accountsFrom(phrases));
    });
  }

  async function refresh() {
    if (!accounts || !deal) return;
    await run("Reading the testnet", async () => {
      const next: Partial<Record<Role, string>> = {};
      for (const role of ROLES) {
        try {
          next[role] = (await readUqor(accounts[role].cosmos)).toString();
        } catch (caught) {
          if (caught instanceof Error && caught.message.includes("not on chain")) next[role] = "0";
          else throw caught;
        }
      }
      setBalances(next);
      if (!deal.escrow) {
        setOnChain(null);
        return;
      }
      const view = await dealStatus(getAddress(deal.escrow));
      setOnChain(`${STATUS_WORD[view.status] ?? "Unknown"} · ${short(view.client)} and ${short(view.freelancer)}`);
    });
  }

  if (!ready) {
    return (
      <p className="mt-8 text-muted" role="status">
        Opening the practice deal.
      </p>
    );
  }

  if (!deal || !accounts) {
    return (
      <section className="mt-10 rounded-xl bg-surface px-5 py-6 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-6">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
          <span className="num text-[12px] text-faint">Step 01 · Local test identities</span>
        </div>
        <h2 className="mt-3 text-[22px] font-medium tracking-[-0.03em] text-ink">No identities in this browser.</h2>
        <p className="mt-3 max-w-[58ch] text-[15px] text-muted">
          Make two test identities, one for each name on the line. The contract also refuses to create an escrow
          without three registered panel keys, so this page makes those three as well. They cannot be paid. They are
          not the project accounts.
        </p>
        <button
          type="button"
          onClick={() => void make()}
          disabled={busy !== null}
          className="mt-5 inline-flex h-11 items-center rounded-lg bg-action px-4 text-sm font-medium text-on-action transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ?? "Make the two test identities"}
        </button>
        {error ? (
          <p className="mt-4 text-sm text-refused" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  const client = getAddress(accounts.client.evm);
  const freelancer = getAddress(accounts.freelancer.evm);
  const actor = accounts[side];
  const feeLine = `Sending. The fee is ${FEE} uqor.`;
  const receiptCurrent = Boolean(deal.escrow) && !deal.receipt;
  const deliverCurrent = Boolean(deal.escrow) && Boolean(deal.receipt) && !deal.delivered;

  return (
    <>
      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)]">
        <PracticeLine client={client} freelancer={freelancer} />
        <div className="min-w-0 space-y-8">
          <section className="rounded-xl bg-surface px-5 py-5 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <h2 className="text-[18px] font-medium tracking-[-0.025em] text-ink">
              The two names, and the panel the contract requires
            </h2>
            <p className="mt-2 max-w-[62ch] text-sm text-muted">
              The panel keys cannot be paid. The phrases stay in this browser. A script on this origin can read them.
              Copy them before you register. Forget deletes them from this browser.
            </p>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-ink">Show the five phrases</summary>
              <ul className="mt-3 grid gap-3">
                {ROLES.map((role) => (
                  <li key={role} className="rounded-lg bg-canvas px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
                    <p className="text-[11px] tracking-[0.08em] text-faint uppercase">{role}</p>
                    <p className="num mt-1 text-[13px] break-all text-ink">{deal.phrases[role]}</p>
                  </li>
                ))}
              </ul>
            </details>
            <label className="mt-4 flex items-start gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-1"
                checked={deal.copied}
                onChange={(event) => keep({ ...deal, copied: event.target.checked })}
              />
              <span>I have copied the phrases.</span>
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!deal.copied || busy !== null}
                onClick={() =>
                  ask("Register the five identities", feeLine, async () => {
                    const hashes: string[] = [];
                    for (const role of ROLES) {
                      if (await registered(accounts[role])) continue;
                      hashes.push(await registerIdentity(accounts[role]));
                    }
                    setNote(hashes.length ? `Registered. ${hashes[hashes.length - 1]}` : "All five were already registered.");
                  })
                }
                className="inline-flex h-11 items-center rounded-lg bg-action px-4 text-sm font-medium text-on-action transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Register
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  ask(
                    "Forget these identities",
                    "The phrases leave this browser. A copy you wrote down is the only backup.",
                    async () => {
                      forgetDeal();
                      setDeal(null);
                      setAccounts(null);
                      setOnChain(null);
                    },
                    "Forget them",
                  )
                }
                className="inline-flex h-11 items-center rounded-lg bg-raise px-4 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
              >
                Forget
              </button>
            </div>
          </section>

          <fieldset className="rounded-xl bg-surface px-5 py-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <legend className="px-1 text-sm text-muted">Who is signing</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["client", "freelancer"] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  aria-pressed={side === role}
                  onClick={() => setSide(role)}
                  className={`inline-flex h-11 items-center rounded-lg px-4 text-sm font-medium transition-colors ${
                    side === role
                      ? "bg-action text-on-action"
                      : "bg-raise text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
                  }`}
                >
                  {role === "client" ? "You as the client" : "You as the freelancer"}
                </button>
              ))}
            </div>
            <p className="num mt-3 text-[13px] break-all text-muted">{actor.evm}</p>
          </fieldset>

          <section
            className="rounded-xl bg-surface px-5 py-5 shadow-[inset_0_0_0_1px_var(--color-line)]"
            aria-busy={busy !== null}
          >
            <h2 className="text-[18px] font-medium tracking-[-0.025em] text-ink">The practice deal</h2>
            <p className="mt-2 max-w-[62ch] text-sm text-muted">
              One milestone of 0.1 fUSD. Review is 120 seconds. The delivery commitment is a hash of this escrow address.
              It is not the sealed file. QoreX can fund the client. It signs with its own key, not these phrases, and it
              does not sign a release. MetaMask can add chain 9800. It cannot make the ML-DSA-87 signature.
            </p>
            <p className="mt-3 text-sm">
              <a className="text-ink underline underline-offset-4" href="https://dashboard.qorechain.io/faucet">
                Testnet faucet
              </a>
              <span className="text-muted"> · 100 QOR and 1000 fUSD each day.</span>
            </p>
            {deal.escrow ? <p className="num mt-3 text-[13px] break-all text-ink">Escrow {deal.escrow}</p> : null}
            {onChain ? <p className="mt-2 text-sm text-ink">{onChain}</p> : null}
            {busy ? (
              <p className="mt-3 text-sm text-ink" role="status">
                {busy === "Making the identities" || busy === "Reading the testnet" ? busy : feeLine}
              </p>
            ) : null}
            {error ? (
              <p className="mt-3 text-sm text-refused" role="alert">
                {error}{" "}
                <button type="button" className="underline" onClick={() => setError(null)}>
                  Dismiss
                </button>
              </p>
            ) : null}
            {note ? <p className="num mt-3 text-[13px] break-all text-ink">{note}</p> : null}

            <div className="mt-5 flex flex-col items-stretch gap-2 border-t border-line pt-4 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="text-sm text-muted">
                QOR from QoreX, in uqor
                <input
                  value={qorAmount}
                  onChange={(event) => setQorAmount(event.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  className="num mt-1 block h-11 w-full max-w-[16rem] rounded-lg bg-canvas px-3 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
                />
              </label>
              <button
                type="button"
                disabled={busy !== null || !qorexPresent()}
                onClick={() =>
                  ask(
                    "Fund the client from QoreX",
                    `QoreX sends ${qorAmount || "0"} uqor to the client. QoreX sets the fee.`,
                    async () => {
                      const sent = await fundFromQorex(accounts.client.cosmos, BigInt(qorAmount || "0"));
                      setNote(sent.hash);
                    },
                  )
                }
                className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-raise px-4 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)] disabled:opacity-40 sm:w-auto"
              >
                {qorexPresent() ? "Fund with QoreX" : "QoreX is not installed"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run("Adding the testnet", async () => {
                    setWallet(await addMetaMask());
                  })
                }
                className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-raise px-4 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)] disabled:opacity-40 sm:w-auto"
              >
                Add chain 9800
              </button>
            </div>
            {wallet ? <p className="num mt-2 text-[13px] break-all text-muted">MetaMask {wallet}. It is not a party.</p> : null}
            <p className="mt-3 text-[13px] text-faint">
              Suggested fund is {suggestedQor().toString()} uqor ({qor(suggestedQor())} QOR).
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Action
                disabled={busy !== null}
                label="Pass 2000000 uqor to each other identity"
                onClick={() =>
                  ask("Pass QOR to the other four", feeLine, async () => {
                    const hash = await passQor(
                      accounts.client,
                      ROLES.filter((role) => role !== "client").map((role) => accounts[role]),
                    );
                    setNote(hash);
                  })
                }
              />
              <Action
                disabled={busy !== null || Boolean(deal.escrow)}
                label="Create the escrow"
                onClick={() =>
                  ask("Create the escrow", feeLine, async () => {
                    const escrow = await createEscrow(accounts);
                    keep({ ...deal, escrow });
                    setNote(escrow);
                  })
                }
              />
              <Action
                disabled={busy !== null || !deal.escrow || side !== "client"}
                label="Convert 0.1 fUSD and fund"
                onClick={() =>
                  ask("Convert and fund", feeLine, async () => {
                    await convertAndFund(accounts.client, getAddress(deal.escrow!));
                    setNote("Funded.");
                  })
                }
              />
            </div>

            <div className="mt-5 border-t border-line pt-4">
              <ol className="grid gap-3">
                <li className="min-w-0 rounded-lg bg-canvas p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${receiptCurrent ? "bg-brand" : "bg-line"}`}
                      aria-hidden="true"
                    />
                    <p className="text-[12px] font-medium tracking-[0.08em] text-faint uppercase">1 Receipt</p>
                  </div>
                  <p className="mt-1.5 text-sm text-muted">{stepState(deal, side, "receipt")}</p>
                  <div className="mt-3">
                    <Action
                      disabled={busy !== null || !deal.escrow || side !== "client" || Boolean(deal.receipt)}
                      label="Receipt the sealed file"
                      onClick={() =>
                        ask(
                          "Receipt the sealed file",
                          `${feeLine} The account is this browser’s client. The window allows only 0x06b52afc4a151b0efa260e2adcdf2d477632cb56. Open and close are ${FEE} uqor each. Registration, if this client is new, is one more fee of ${FEE} uqor. The last record on this contract used 288262 gas. This click prices the call and stops above 1320000 uqor. Courier does not carry the file.`,
                          async () => {
                            const receipt = await receiptSealedFile(accounts.client, getAddress(deal.escrow!));
                            keep({ ...deal, receipt });
                            setNote("Receipt stored. Courier did not carry the file.");
                          },
                        )
                      }
                    />
                  </div>
                </li>
                <li className="min-w-0 rounded-lg bg-canvas p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${deliverCurrent ? "bg-brand" : "bg-line"}`}
                      aria-hidden="true"
                    />
                    <p className="text-[12px] font-medium tracking-[0.08em] text-faint uppercase">2 Deliver</p>
                  </div>
                  <p className="mt-1.5 text-sm text-muted">{stepState(deal, side, "deliver")}</p>
                  <div className="mt-3">
                    <Action
                      disabled={busy !== null || !deal.escrow || !deal.receipt || side !== "freelancer" || Boolean(deal.delivered)}
                      label="Deliver the sealed file"
                      onClick={() =>
                        ask(
                          "Deliver the sealed file",
                          `${feeLine} The account is this browser’s freelancer. The window allows only this practice escrow. Open and close are ${FEE} uqor each. The call is priced before it is sent and stops above 1320000 uqor. Courier does not carry the file.`,
                          async () => {
                            await deliverCommitment(
                              accounts.freelancer,
                              getAddress(deal.escrow!),
                              deal.receipt!.commitment as Hex,
                            );
                            keep({ ...deal, delivered: true });
                            setNote("The file was committed and receipted. Courier did not carry it.");
                          },
                        )
                      }
                    />
                  </div>
                </li>
              </ol>
              <p className="mt-3 max-w-[62ch] text-sm text-muted">
                Courier did not carry this file. The client receipts it, then the freelancer delivers that same file on
                the one milestone. After both land, the file was committed and receipted. The page cannot open the file.
              </p>
              {deal.receipt ? (
                <div className="mt-3 grid gap-1.5 rounded-lg bg-canvas p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
                  <p className="num text-[12px] break-all text-muted">Ciphertext {deal.receipt.ciphertextHash}</p>
                  <p className="num text-[12px] break-all text-muted">Commitment {deal.receipt.commitment}</p>
                  <p className="num text-[12px] break-all text-muted">Receipt {deal.receipt.recordHash}</p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">No sealed file yet.</p>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:flex-wrap">
              <Action
                disabled={busy !== null || !deal.escrow || side !== "client" || !deal.delivered}
                label="Release"
                onClick={() =>
                  ask("Release", feeLine, async () => {
                    const signature = await release(accounts.client, getAddress(deal.escrow!));
                    keep({ ...deal, releaseSignature: signature });
                    setNote("Released to the freelancer.");
                  })
                }
              />
              <Action
                disabled={busy !== null || !deal.escrow}
                label="Dispute"
                onClick={() =>
                  ask("Dispute", feeLine, async () => {
                    await dispute(actor, getAddress(deal.escrow!), side === "client");
                    setNote("Disputed.");
                  })
                }
              />
              <Action
                disabled={busy !== null || !deal.escrow}
                label="Resolve 50 / 50"
                onClick={() =>
                  ask("Resolve", `${feeLine} Two panel keys sign. The pay still goes only to the two names.`, async () => {
                    await resolveHalf(actor, accounts["arbiter-1"], accounts["arbiter-2"], getAddress(deal.escrow!));
                    setNote("Resolved at 5000 bps.");
                  })
                }
              />
              <Action disabled={busy !== null} label="Read the testnet" onClick={() => void refresh()} />
            </div>

            <div className="mt-6 border-t border-line pt-5">
              <h3 className="text-[12px] font-medium tracking-[0.08em] text-faint uppercase">Try to steal the pay</h3>
              <p className="mt-2 max-w-[62ch] text-sm text-muted">
                This uses the client identity. The classical open is broadcast and has to fail, so there is no success
                hash. If the milestone is delivered, a second window carries a release signed with 4627 zero bytes. That
                signature is not ML-DSA-87. The window is opened with the registered key only so the refusal can be
                mined. The replay is read and not sent. Nothing here can name a new recipient.
              </p>
              <button
                type="button"
                disabled={busy !== null || !deal.escrow}
                onClick={() =>
                  ask(
                    "Try to steal the pay",
                    `The classical open costs ${FEE} uqor and must be refused. If the milestone is delivered, the zero-signature release costs two more fees of ${FEE} uqor, plus the call gas.`,
                    async () => {
                      const lines = await stealPay(
                        accounts.client,
                        getAddress(deal.escrow!),
                        (deal.releaseSignature as Hex | undefined) ?? null,
                      );
                      setStolen(lines);
                      setNote(lines.map((line) => line.attempt).join(", "));
                    },
                  )
                }
                className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg bg-raise px-4 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)] disabled:opacity-40 sm:w-auto"
              >
                Try to steal the pay
              </button>
              {stolen.length > 0 ? (
                <ul className="mt-3 grid gap-2">
                  {stolen.map((line) => (
                    <li
                      key={line.attempt}
                      className="min-w-0 rounded-lg bg-canvas px-3 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]"
                    >
                      <p className="text-sm text-ink">{line.attempt}</p>
                      <p className="num mt-1 text-[13px] break-all text-muted">{line.detail}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="mt-6 border-t border-line pt-5">
              <h3 className="text-[12px] font-medium tracking-[0.08em] text-faint uppercase">Other refusals</h3>
              <p className="mt-2 max-w-[62ch] text-sm text-muted">
                These three are read and not broadcast. The classical open below is the same refusal as the first steal
                attempt, on its own.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Action
                  disabled={busy !== null || !deal.escrow}
                  label="Wrong milestone"
                  onClick={() =>
                    void run("Reading the refusal", async () => {
                      setNote(await wrongMilestone(getAddress(deal.escrow!)));
                    })
                  }
                />
                <Action
                  disabled={busy !== null || !deal.escrow}
                  label="Early timeout"
                  onClick={() =>
                    void run("Reading the refusal", async () => {
                      setNote(await earlyRelease(getAddress(deal.escrow!)));
                    })
                  }
                />
                <Action
                  disabled={busy !== null || !deal.escrow || !deal.releaseSignature}
                  label="Replay the release"
                  onClick={() =>
                    void run("Reading the refusal", async () => {
                      setNote(await replayRelease(getAddress(deal.escrow!), deal.releaseSignature as Hex));
                    })
                  }
                />
                <Action
                  disabled={busy !== null}
                  label="Classical open"
                  onClick={() =>
                    ask("Open a window with the classical key", feeLine, async () => {
                      const result = await classicalWindow(actor);
                      setNote(result.detail);
                    })
                  }
                />
              </div>
              <dl className="mt-5 grid gap-2 border-t border-line pt-4 text-[13px] sm:grid-cols-2">
                {ROLES.map((role) => (
                  <div key={role} className="min-w-0">
                    <dt className="text-faint">{role}</dt>
                    <dd className="num break-all text-ink">
                      {short(accounts[role].evm)}
                      {balances[role] ? ` · ${balances[role]} uqor` : ""}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        </div>
      </div>

      {confirm ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-[1080px]">
            <p className="text-sm font-medium text-ink">{confirm.title}</p>
            <p className="mt-1 max-w-[62ch] text-sm text-muted">{confirm.body}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void confirm.run()}
                className="inline-flex h-11 items-center rounded-lg bg-action px-4 text-sm font-medium text-on-action"
              >
                {confirm.confirm}
              </button>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="inline-flex h-11 items-center rounded-lg px-4 text-sm text-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Action({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-raise px-4 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors enabled:hover:bg-canvas disabled:opacity-40 sm:w-auto"
    >
      {label}
    </button>
  );
}

function PracticeLine({ client, freelancer }: { client: Address; freelancer: Address }) {
  return (
    <aside className="w-full self-start rounded-xl bg-surface px-4 py-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:px-5 lg:sticky lg:top-20 lg:z-10">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium tracking-[0.08em] text-client uppercase">Client</span>
        <span className="num text-[12px] text-muted" title={client}>
          {short(client)}
        </span>
      </div>
      <div className="rule my-3" />
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium tracking-[0.08em] text-freelancer uppercase">Freelancer</span>
        <span className="num text-[12px] text-muted" title={freelancer}>
          {short(freelancer)}
        </span>
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <p className="num text-[12px] text-ink">0.1 fUSD · 120s review</p>
        <p className="mt-1 text-[13px] text-faint">These two names are fixed when the escrow is created.</p>
      </div>
    </aside>
  );
}
