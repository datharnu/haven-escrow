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
  courierPays,
  readCarriedReceipt,
  type CarryStart,
  type CourierPay,
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
const CARRY_KEY = "haven-escrow-carry";

function readCarry(): CarryStart | null {
  const raw = localStorage.getItem(CARRY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CarryStart;
    if (!parsed.escrow || !parsed.createHash || !parsed.convertHash) return null;
    return parsed;
  } catch {
    return null;
  }
}

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
  const [family, setFamily] = useState<CourierPay | null>(null);

  useEffect(() => {
    const saved = loadDeal();
    setDeal(saved);
    setReady(true);
    const raw = localStorage.getItem("haven-escrow-family");
    if (raw) {
      try {
        setFamily(JSON.parse(raw) as CourierPay);
      } catch {
        setFamily(null);
      }
    }
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
      <section className="mt-10 rounded-xl bg-surface px-5 py-6 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <h2 className="text-[22px] tracking-[-0.03em]">No identities in this browser.</h2>
        <p className="mt-3 max-w-[58ch] text-muted">
          Make two test identities, one for each name on the line. The contract also refuses to create an escrow
          without three registered panel keys, so this page makes those three as well. They cannot be paid. They are
          not the project accounts.
        </p>
        <button
          type="button"
          onClick={() => void make()}
          disabled={busy !== null}
          className="mt-5 inline-flex h-11 items-center rounded-lg bg-brand px-4 text-sm text-on-brand disabled:opacity-40"
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

  return (
    <>
    <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <section className="rounded-xl bg-surface px-5 py-5 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <h2 className="text-[18px] tracking-[-0.03em]">The two names, and the panel the contract requires</h2>
          <p className="mt-2 max-w-[62ch] text-sm text-muted">
            The panel keys cannot be paid. The phrases stay in this browser. A script on this origin can read them.
            Copy them before you register. Forget deletes them from this browser.
          </p>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm">Show the five phrases</summary>
            <ul className="mt-3 grid gap-3">
              {ROLES.map((role) => (
                <li key={role}>
                  <p className="text-[12px] tracking-[0.08em] text-faint uppercase">{role}</p>
                  <p className="num mt-1 text-[13px] break-all">{deal.phrases[role]}</p>
                </li>
              ))}
            </ul>
          </details>
          <label className="mt-4 flex items-start gap-2 text-sm">
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
              className="inline-flex h-11 items-center rounded-lg bg-brand px-4 text-sm text-on-brand disabled:opacity-40"
            >
              Register
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                ask("Forget these identities", "The phrases leave this browser. A copy you wrote down is the only backup.", async () => {
                  forgetDeal();
                  setDeal(null);
                  setAccounts(null);
                  setOnChain(null);
                }, "Forget them")
              }
              className="inline-flex h-11 items-center rounded-lg bg-raise px-4 text-sm shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              Forget
            </button>
          </div>
        </section>

        <fieldset className="mt-4 rounded-xl bg-surface px-5 py-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <legend className="px-1 text-sm text-muted">Who is signing</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["client", "freelancer"] as const).map((role) => (
              <button
                key={role}
                type="button"
                aria-pressed={side === role}
                onClick={() => setSide(role)}
                className={`inline-flex h-11 items-center rounded-lg px-4 text-sm ${side === role ? "bg-brand text-on-brand" : "bg-raise shadow-[inset_0_0_0_1px_var(--color-line)]"}`}
              >
                {role === "client" ? "You as the client" : "You as the freelancer"}
              </button>
            ))}
          </div>
          <p className="num mt-3 text-[13px] break-all text-muted">{actor.evm}</p>
        </fieldset>

        <section className="mt-4 rounded-xl bg-surface px-5 py-5 shadow-[inset_0_0_0_1px_var(--color-line)]" aria-busy={busy !== null}>
          <h2 className="text-[18px] tracking-[-0.03em]">The practice deal</h2>
          <p className="mt-2 max-w-[62ch] text-sm text-muted">
            One milestone of 0.1 fUSD. Review is 120 seconds. The delivery commitment is a hash of this escrow address.
            It is not the sealed file. QoreX can fund the client. It signs with its own key, not these phrases, and it
            does not sign a release. MetaMask can add chain 9800. It cannot make the ML-DSA-87 signature.
          </p>
          <p className="mt-3 text-sm">
            <a className="underline" href="https://dashboard.qorechain.io/faucet">
              Testnet faucet
            </a>
            <span className="text-muted"> · 100 QOR and 1000 fUSD each day.</span>
          </p>
          {deal.escrow ? <p className="num mt-3 text-[13px] break-all">Escrow {deal.escrow}</p> : null}
          {onChain ? <p className="mt-2 text-sm">{onChain}</p> : null}
          {busy ? (
            <p className="mt-3 text-sm" role="status">
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
          {note ? <p className="num mt-3 text-[13px] break-all">{note}</p> : null}

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              QOR from QoreX, in uqor
              <input
                value={qorAmount}
                onChange={(event) => setQorAmount(event.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="mt-1 block h-11 w-full max-w-[16rem] rounded-lg bg-canvas px-3 num text-sm shadow-[inset_0_0_0_1px_var(--color-line)]"
              />
            </label>
            <button
              type="button"
              disabled={busy !== null || !qorexPresent()}
              onClick={() =>
                ask("Fund the client from QoreX", `QoreX sends ${qorAmount || "0"} uqor to the client. QoreX sets the fee.`, async () => {
                  const sent = await fundFromQorex(accounts.client.cosmos, BigInt(qorAmount || "0"));
                  setNote(sent.hash);
                })
              }
              className="inline-flex h-11 items-center rounded-lg bg-raise px-4 text-sm shadow-[inset_0_0_0_1px_var(--color-line)] disabled:opacity-40"
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
              className="inline-flex h-11 items-center rounded-lg bg-raise px-4 text-sm shadow-[inset_0_0_0_1px_var(--color-line)] disabled:opacity-40"
            >
              Add chain 9800
            </button>
          </div>
          {wallet ? <p className="num mt-2 text-[13px] break-all">MetaMask {wallet}. It is not a party.</p> : null}
          <p className="mt-3 text-[13px] text-faint">Suggested fund is {suggestedQor().toString()} uqor ({qor(suggestedQor())} QOR).</p>

          <div className="mt-4 flex flex-wrap gap-2">
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
                  const created = await createEscrow(accounts);
                  keep({ ...deal, escrow: created.escrow });
                  setNote(created.escrow);
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

          <div className="mt-4">
            <ol className="grid gap-3 sm:grid-cols-2">
              <li className="min-w-0">
                <p className="text-[13px] tracking-[0.08em] text-faint uppercase">1 Receipt</p>
                <p className="mt-1 text-sm text-muted">{stepState(deal, side, "receipt")}</p>
                <div className="mt-2">
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
              <li className="min-w-0">
                <p className="text-[13px] tracking-[0.08em] text-faint uppercase">2 Deliver</p>
                <p className="mt-1 text-sm text-muted">{stepState(deal, side, "deliver")}</p>
                <div className="mt-2">
                  <Action
                    disabled={busy !== null || !deal.escrow || !deal.receipt || side !== "freelancer" || Boolean(deal.delivered)}
                    label="Deliver the sealed file"
                    onClick={() =>
                      ask(
                        "Deliver the sealed file",
                        `${feeLine} The account is this browser’s freelancer. The window allows only this practice escrow. Open and close are ${FEE} uqor each. The call is priced before it is sent and stops above 1320000 uqor. Courier does not carry the file.`,
                        async () => {
                          await deliverCommitment(accounts.freelancer, getAddress(deal.escrow!), deal.receipt!.commitment as Hex);
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
              <div className="mt-3 grid gap-2">
                <p className="num text-[13px] break-all">Ciphertext {deal.receipt.ciphertextHash}</p>
                <p className="num text-[13px] break-all">Commitment {deal.receipt.commitment}</p>
                <p className="num text-[13px] break-all">Receipt {deal.receipt.recordHash}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">No sealed file yet.</p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Action
              disabled={busy !== null || !deal.escrow || side !== "client" || !deal.delivered}
              label="Release"
              onClick={() =>
                ask("Release", feeLine, async () => {
                  const sent = await release(accounts.client, getAddress(deal.escrow!));
                  keep({ ...deal, releaseSignature: sent.signature });
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
            <Action
              disabled={busy !== null}
              label="Read the testnet"
              onClick={() => void refresh()}
            />
          </div>

          <h3 className="mt-6 text-sm tracking-[0.08em] text-faint uppercase">Try to steal the pay</h3>
          <p className="mt-2 max-w-[62ch] text-sm text-muted">
            This uses the client identity. The classical open is broadcast and has to fail, so there is no success hash.
            If the milestone is delivered, a second window carries a release signed with 4627 zero bytes. That signature
            is not ML-DSA-87. The window is opened with the registered key only so the refusal can be mined. The replay
            is read and not sent. Nothing here can name a new recipient.
          </p>
          <button
            type="button"
            disabled={busy !== null || !deal.escrow}
            onClick={() =>
              ask(
                "Try to steal the pay",
                `The classical open costs ${FEE} uqor and must be refused. If the milestone is delivered, the zero-signature release costs two more fees of ${FEE} uqor, plus the call gas.`,
                async () => {
                  const lines = await stealPay(accounts.client, getAddress(deal.escrow!), (deal.releaseSignature as Hex | undefined) ?? null);
                  setStolen(lines);
                  setNote(lines.map((line) => line.attempt).join(", "));
                },
              )
            }
            className="mt-3 inline-flex h-11 items-center rounded-lg bg-raise px-4 text-sm shadow-[inset_0_0_0_1px_var(--color-line)] disabled:opacity-40"
          >
            Try to steal the pay
          </button>
          {stolen.length > 0 ? (
            <ul className="mt-3 grid gap-2">
              {stolen.map((line) => (
                <li key={line.attempt} className="min-w-0 rounded-lg bg-canvas px-3 py-3">
                  <p className="text-sm">{line.attempt}</p>
                  <p className="num mt-1 text-[13px] break-all text-muted">{line.detail}</p>
                </li>
              ))}
            </ul>
          ) : null}

          <h3 className="mt-6 text-sm tracking-[0.08em] text-faint uppercase">Other refusals</h3>
          <p className="mt-2 max-w-[62ch] text-sm text-muted">
            These three are read and not broadcast. The classical open below is the same refusal as the first steal
            attempt, on its own.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
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
          <dl className="mt-5 grid gap-2 text-[13px] sm:grid-cols-2">
            {ROLES.map((role) => (
              <div key={role} className="min-w-0">
                <dt className="text-faint">{role}</dt>
                <dd className="num break-all">{short(accounts[role].evm)}{balances[role] ? ` · ${balances[role]} uqor` : ""}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      {accounts ? (
        <section className="mt-4 min-w-0 rounded-xl bg-surface px-5 py-5 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <h2 className="text-[18px] tracking-[-0.03em]">Courier delivers, Escrow pays</h2>
          <p className="mt-2 max-w-[62ch] text-sm text-muted">
            The freelancer seals one file with Courier. The client opens it in this browser and signs the delivery receipt.
            HavenEscrow does not read DeliveryReceipts. The page does. No directory bundle is published, and no relay is hosted.
          </p>
          <div className="mt-4">
            <Action
              disabled={busy !== null || family !== null}
              label="Carry the file and release"
              onClick={() => {
                const open = readCarry();
                const fresh = `One confirmation creates a new escrow, sends the file, records the receipt, delivers that ciphertext, and releases. It does not touch 0xb0d8Da3B7979120E6877016810D39a792a3Bdf90. The client pays about 574659 uqor to create (open ${FEE}, call 214659 from the last create of 1908074 gas, close ${FEE}), ${FEE} uqor to convert, about 369079 uqor to fund (open ${FEE}, call 9079 from 80696 gas, close ${FEE}), about 390541 uqor to record the receipt (open ${FEE}, call 30541 from 271474 gas, close ${FEE}), and about 392688 uqor to release (open ${FEE}, call 32688 from 290557 gas, close ${FEE}). The freelancer pays about 389252 uqor to deliver (open ${FEE}, call 29252 from 260016 gas, close ${FEE}). Each call is priced again and stops above 1320000 uqor. The create stops above 3300000 uqor. Gas price on 21 November 2026 was 112500000000 wei.`;
                const funded = open
                  ? `The escrow ${open.escrow} is funded. This confirmation does not fund it again, does not create another escrow, and does not touch 0xb0d8Da3B7979120E6877016810D39a792a3Bdf90. The client pays about 390541 uqor to record the receipt (open ${FEE}, call 30541 from 271474 gas, close ${FEE}) and about 392688 uqor to release (open ${FEE}, call 32688 from 290557 gas, close ${FEE}). The freelancer pays about 389252 uqor to deliver (open ${FEE}, call 29252 from 260016 gas, close ${FEE}). Each call is priced again and stops above 1320000 uqor. Gas price on 21 November 2026 was 112500000000 wei.`
                  : fresh;
                const again = open?.fundHash
                  ? funded
                  : open
                    ? `The escrow ${open.escrow} already holds the 0.1 fUSD. This confirmation does not create another escrow and does not touch 0xb0d8Da3B7979120E6877016810D39a792a3Bdf90. The client pays about 369079 uqor to fund (open ${FEE}, call 9079 from 80696 gas, close ${FEE}), about 390541 uqor to record the receipt (open ${FEE}, call 30541 from 271474 gas, close ${FEE}), and about 392688 uqor to release (open ${FEE}, call 32688 from 290557 gas, close ${FEE}). The freelancer pays about 389252 uqor to deliver (open ${FEE}, call 29252 from 260016 gas, close ${FEE}). Each call is priced again and stops above 1320000 uqor. Gas price on 21 November 2026 was 112500000000 wei.`
                    : fresh;
                ask(
                  "Courier delivers, Escrow pays",
                  again,
                  async () => {
                    const paid = await courierPays(accounts, open ?? undefined, (partial) => {
                      localStorage.setItem(CARRY_KEY, JSON.stringify(partial));
                    });
                    localStorage.setItem("haven-escrow-family", JSON.stringify(paid));
                    localStorage.removeItem(CARRY_KEY);
                    setFamily(paid);
                    setNote(paid.escrow);
                  },
                  "Send",
                );
              }}
            />
          </div>
          {family ? <FamilyReceipt run={family} client={getAddress(accounts.client.evm)} /> : <p className="mt-3 text-sm text-muted">No file has been carried.</p>}
        </section>
      ) : null}
      <PracticeLine client={client} freelancer={freelancer} />
    </div>
    {confirm ? (
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="text-sm">{confirm.title}</p>
        <p className="mt-1 max-w-[62ch] text-sm text-muted">{confirm.body}</p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void confirm.run()}
            className="inline-flex h-11 items-center rounded-lg bg-brand px-4 text-sm text-on-brand"
          >
            {confirm.confirm}
          </button>
          <button type="button" onClick={() => setConfirm(null)} className="inline-flex h-11 items-center rounded-lg px-4 text-sm">
            Cancel
          </button>
        </div>
      </div>
    ) : null}
    </>
  );
}

function FamilyReceipt({ run, client }: { run: CourierPay; client: Address }) {
  const [read, setRead] = useState<"reading" | "matched" | "unread">("reading");
  useEffect(() => {
    let cancel = false;
    readCarriedReceipt({
      conversationId: run.conversationId as Hex,
      counter: run.counter,
      ciphertextHash: run.ciphertextHash as Hex,
      recipient: client,
    }).then((recordedAt) => {
      if (!cancel) setRead(recordedAt !== null && recordedAt > 0n ? "matched" : "unread");
    });
    return () => {
      cancel = true;
    };
  }, [run, client]);
  return (
    <div className="mt-4 grid min-w-0 gap-2">
      <p className="min-w-0 text-[13px] break-words text-muted">
        Escrow{" "}
        <span className="num break-all text-ink" title={run.escrow}>
          {short(run.escrow)}
        </span>
      </p>
      <p className="min-w-0 text-[13px] break-words text-muted">
        Ciphertext{" "}
        <span className="num break-all text-ink" title={run.ciphertextHash}>
          {short(run.ciphertextHash)}
        </span>
      </p>
      <p className="text-sm text-muted">
        {read === "reading" ? "Reading the testnet." : null}
        {read === "unread" ? "The check could not be read." : null}
        {read === "matched" ? "receipt() holds this ciphertext hash. It is the file Courier carried." : null}
      </p>
      <p className="text-[13px] text-faint">HavenEscrow does not read DeliveryReceipts.</p>
      <p className="min-w-0 text-[13px] break-words text-muted">
        Paid{" "}
        <span className="num break-all text-ink" title={run.payee}>
          {short(run.payee)}
        </span>
      </p>
    </div>
  );
}

function Action({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-11 items-center rounded-lg bg-raise px-4 text-sm shadow-[inset_0_0_0_1px_var(--color-line)] disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function PracticeLine({ client, freelancer }: { client: Address; freelancer: Address }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] tracking-[0.08em] text-client uppercase">Client</span>
        <span className="num text-[12px] text-muted" title={client}>
          {short(client)}
        </span>
      </div>
      <div className="rule my-3" />
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] tracking-[0.08em] text-freelancer uppercase">Freelancer</span>
        <span className="num text-[12px] text-muted" title={freelancer}>
          {short(freelancer)}
        </span>
      </div>
      <p className="mt-3 text-[13px] text-faint">These two names are fixed when the escrow is created.</p>
    </div>
  );
}
