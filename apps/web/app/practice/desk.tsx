"use client";

import { useEffect, useRef, useState } from "react";
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
  readFusd,
  readUqor,
  SEQUENCE_SLIP,
  registerIdentity,
  registered,
  receiptSealedFile,
  release,
  replayRelease,
  resolveHalf,
  stealPay,
  wrongMilestone,
} from "@/lib/practice-chain";
import { NATIVE_FEE, PRACTICE_AMOUNT, ROLES, suggestedQor, type Role } from "@/lib/practice";
import { guideStep, nextStep, stepState } from "@/lib/practice-steps";
import { forgetDeal, loadDeal, saveDeal, type SavedDeal } from "@/lib/practice-store";
import { addMetaMask, fundFromQorex, qorexPresent } from "@/lib/practice-wallet";
import { NETWORK as TESTNET_DOWN } from "@/lib/verify";
import type { UnifiedAccount } from "@qorechain/sdk";

const FEE = NATIVE_FEE.amount[0].amount;
const FAUCET = "https://dashboard.qorechain.io/faucet";

/** Where a status line renders: under the controls that started the action. */
type Zone = "identities" | "fund" | "setup" | "steps" | "settle" | "steal" | "refusals";

type Problem = { text: string; raw: string; quiet: boolean; fix: "retry" | "fund" | "pass" | "register" | null };

const FEE_UQOR = BigInt(FEE);
/** Open and close. Gas is priced later, so this floor never blocks a send that could succeed. */
const WINDOW_FLOOR = FEE_UQOR * 2n;
/** Four transfers of 2000000 uqor, plus the one broadcast fee. */
const PASS_NEED = 2_000_000n * 4n + FEE_UQOR;

function explain(raw: string): Problem {
  if (raw === TESTNET_DOWN) {
    return { text: "Couldn't reach the testnet. Check the connection and try again.", raw: "", quiet: false, fix: "retry" };
  }
  if (/QoreX does not have enough|\(code 5\)/.test(raw)) {
    return {
      text: /QoreX does not have enough/.test(raw)
        ? raw
        : "QoreX does not have enough QOR for this send. Fund the QoreX account from the faucet, or lower the amount.",
      raw: "",
      quiet: false,
      fix: "fund",
    };
  }
  if (/KeyNotRegistered|Register the five identities first|Register these before/.test(raw)) {
    return {
      text: raw.startsWith("Register") ? raw : "Register the five identities before creating the escrow.",
      raw: "",
      quiet: false,
      fix: "register",
    };
  }
  if (/The contract refused this/.test(raw)) {
    return { text: raw, raw: "", quiet: false, fix: null };
  }
  if (/not on chain|insufficient/i.test(raw)) {
    return { text: "This identity does not have enough test QOR for the fee.", raw, quiet: false, fix: "fund" };
  }
  if (/Estimate Gas Arguments|Execution reverted for an unknown reason/.test(raw)) {
    return { text: "The contract refused this before it was sent.", raw: "", quiet: false, fix: "register" };
  }
  if (/reject|denied|cancel/i.test(raw)) {
    return { text: "You cancelled in the wallet. Nothing was sent.", raw, quiet: true, fix: null };
  }
  if (/QoreX is not installed/.test(raw)) {
    return { text: "QoreX is not installed in this browser. The faucet works without it.", raw, quiet: false, fix: "fund" };
  }
  if (raw === SEQUENCE_SLIP || /account sequence mismatch|incorrect account sequence/.test(raw)) {
    return { text: SEQUENCE_SLIP, raw: "", quiet: false, fix: null };
  }
  if (/Cannot convert undefined to a BigInt/.test(raw)) {
    return { text: "The page could not read a number from the escrow. Refresh and try again.", raw: "", quiet: false, fix: null };
  }
  return { text: "The testnet refused this. The reason is under Details.", raw, quiet: false, fix: null };
}

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : "The action failed.";
}

function roleLabel(role: Role) {
  if (role === "client") return "the client";
  if (role === "freelancer") return "the freelancer";
  return role.replace("-", " ");
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
  const [error, setError] = useState<{ problem: Problem; retry: () => void } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [zone, setZone] = useState<Zone | null>(null);
  const [stolen, setStolen] = useState<{ attempt: string; detail: string }[]>([]);
  const [confirm, setConfirm] = useState<{ title: string; body: string; confirm: string; run: () => Promise<void> } | null>(null);
  const [qorAmount, setQorAmount] = useState(suggestedQor().toString());
  const [balances, setBalances] = useState<Partial<Record<Role, string>>>({});
  const [onChain, setOnChain] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [showFund, setShowFund] = useState(false);
  const [keys, setKeys] = useState<Partial<Record<Role, boolean>> | null>(null);
  const [fusd, setFusd] = useState<bigint | null>(null);
  const [milestone, setMilestone] = useState<number | null>(null);
  const [progressError, setProgressError] = useState(false);
  const [seen, setSeen] = useState(0);
  const sendLock = useRef(false);

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

  useEffect(() => {
    if (!accounts) return;
    let cancelled = false;
    void readBalances(accounts)
      .then((next) => {
        if (!cancelled) setBalances(next);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setZone("fund");
        setError({ problem: explain(messageOf(caught)), retry: () => void checkFunds() });
      });
    return () => {
      cancelled = true;
    };
  }, [accounts]);

  useEffect(() => {
    if (!accounts) return;
    const escrow = deal?.escrow;
    let cancelled = false;
    setProgressError(false);
    void (async () => {
      try {
        const map: Partial<Record<Role, boolean>> = {};
        for (const role of ROLES) map[role] = await registered(accounts[role]);
        const coin = await readFusd(accounts.client.cosmos);
        let status: number | null = null;
        if (escrow) {
          const view = await dealStatus(getAddress(escrow));
          status = view.status;
          if (!cancelled) setOnChain(`${STATUS_WORD[view.status] ?? "Unknown"} · ${short(view.client)} and ${short(view.freelancer)}`);
        }
        if (cancelled) return;
        setKeys(map);
        setFusd(coin);
        setMilestone(status);
      } catch {
        if (!cancelled) setProgressError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accounts, deal?.escrow, seen]);

  function keep(next: SavedDeal) {
    saveDeal(next);
    setDeal(next);
  }

  async function readBalances(from: Record<Role, UnifiedAccount>) {
    const next: Partial<Record<Role, string>> = {};
    for (const role of ROLES) next[role] = (await readUqor(from[role].cosmos)).toString();
    return next;
  }

  /** Rereads balances. Returns null when the read failed and the error is already showing. */
  async function checkFunds(at: Zone = "fund"): Promise<Partial<Record<Role, string>> | null> {
    if (!accounts) return null;
    setChecking(true);
    setZone(at);
    setError(null);
    setNote(null);
    try {
      const next = await readBalances(accounts);
      setBalances(next);
      setSeen((n) => n + 1);
      return next;
    } catch (caught) {
      setError({ problem: explain(messageOf(caught)), retry: () => void checkFunds(at) });
      return null;
    } finally {
      setChecking(false);
    }
  }

  async function onRegister() {
    if (!accounts) return;
    const next = await checkFunds("identities");
    if (!next) return;
    const ready = ROLES.filter((role) => BigInt(next[role] ?? "0") >= BigInt(FEE));
    if (!ready.includes("client")) {
      goToFund();
      return;
    }
    const waiting = ROLES.filter((role) => !ready.includes(role));
    ask(
      "identities",
      waiting.length ? "Register the identities that can pay" : "Register the five identities",
      waiting.length
        ? `The client pays ${FEE} uqor. ${waiting.map(roleLabel).join(", ")} still need QOR, so they are not included.`
        : `Each identity pays ${FEE} uqor.`,
      async () => {
        const hashes: string[] = [];
        for (const role of ready) {
          if (await registered(accounts[role])) continue;
          hashes.push(await registerIdentity(accounts[role]));
        }
        setNote(hashes.length ? `Registered. ${hashes[hashes.length - 1]}` : "All five were already registered.");
        setSeen((n) => n + 1);
      },
    );
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setCopyError(null);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
    } catch {
      setCopied(null);
      setCopyError("The browser refused the copy. The text is still on the page.");
    }
  }

  async function run(at: Zone, label: string, work: () => Promise<void>, again?: () => void) {
    setZone(at);
    setError(null);
    setNote(null);
    setBusy(label);
    try {
      await work();
    } catch (caught) {
      setError({ problem: explain(messageOf(caught)), retry: again ?? (() => void run(at, label, work)) });
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  /** Sends always go through the confirm sheet, including a retry after an error. */
  function ask(at: Zone, title: string, body: string, work: () => Promise<void>, confirmLabel = "Send") {
    const again = () => ask(at, title, body, work, confirmLabel);
    setConfirm({ title, body, confirm: confirmLabel, run: () => run(at, `Sending: ${title}`, work, again) });
  }

  function goToFund() {
    setShowFund(true);
    setError(null);
    requestAnimationFrame(() => document.getElementById("fund")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  function goToPass() {
    setError(null);
    requestAnimationFrame(() => document.getElementById("setup")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  function goToRegister() {
    setError(null);
    requestAnimationFrame(() => document.getElementById("register")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  /** Reads the payer first. A short balance never opens the send sheet. */
  async function afford(role: Role, need: bigint, at: Zone): Promise<boolean> {
    const next = await checkFunds(at);
    if (!next) return false;
    const have = BigInt(next[role] ?? "0");
    if (have >= need) return true;
    const who = role === "client" ? "The client" : role === "freelancer" ? "The freelancer" : `Arbiter ${role.slice(-1)}`;
    setError({
      problem: {
        text:
          role === "client"
            ? `${who} has ${have.toString()} uqor. This send needs ${need.toString()}.`
            : `${who} has ${have.toString()} uqor. This send needs ${need.toString()}. Pass QOR from the client first.`,
        raw: "",
        quiet: false,
        fix: role === "client" ? "fund" : "pass",
      },
      retry: () => undefined,
    });
    return false;
  }

  async function gate(at: Zone, role: Role, need: bigint, title: string, body: string, work: () => Promise<void>) {
    if (await afford(role, need, at)) ask(at, title, body, work);
  }

  /** Refuses the confirm sheet when the milestone is not in the state this action can change. */
  async function requireStatus(at: Zone, wanted: number, because: string): Promise<boolean> {
    if (!deal?.escrow) return false;
    setZone(at);
    setError(null);
    setNote(null);
    setBusy("Reading the milestone");
    try {
      const view = await dealStatus(getAddress(deal.escrow));
      setOnChain(`${STATUS_WORD[view.status] ?? "Unknown"} · ${short(view.client)} and ${short(view.freelancer)}`);
      setMilestone(view.status);
      if (view.status === wanted) return true;
      const word = STATUS_WORD[view.status] ?? "in another state";
      setError({
        problem: { text: `The milestone is ${word}. ${because}`, raw: "", quiet: false, fix: null },
        retry: () => undefined,
      });
      return false;
    } catch (caught) {
      setError({ problem: explain(messageOf(caught)), retry: () => undefined });
      return false;
    } finally {
      setBusy(null);
    }
  }

  function status(at: Zone) {
    if (zone !== at) return null;
    return (
      <StatusLine
        busy={busy ?? (checking ? "Reading the balances" : null)}
        error={error}
        note={note}
        onDismiss={() => setError(null)}
        onFund={goToFund}
        onPass={goToPass}
        onRegister={goToRegister}
      />
    );
  }

  async function make() {
    await run("identities", "Making the identities", async () => {
      const phrases = await makePhrases();
      const next = { phrases, copied: false };
      keep(next);
      setAccounts(await accountsFrom(phrases));
    });
  }

  async function refresh() {
    if (!accounts || !deal) return;
    await run("settle", "Reading the testnet", async () => {
      setBalances(await readBalances(accounts));
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
        {error ? status("identities") : null}
      </section>
    );
  }

  const client = getAddress(accounts.client.evm);
  const freelancer = getAddress(accounts.freelancer.evm);
  const actor = accounts[side];
  const windowLine = `Open and close are ${FEE} uqor each. Gas is priced when it sends.`;
  const clientBalance = balances.client;
  const clientCanPay = clientBalance !== undefined && BigInt(clientBalance) >= BigInt(FEE);
  const otherRoles = ["freelancer", "arbiter-1", "arbiter-2", "arbiter-3"] as const;
  const next = nextStep({
    phase: progressError ? "error" : keys === null ? "reading" : "ready",
    clientUqor: clientBalance === undefined ? null : BigInt(clientBalance),
    otherUqor: otherRoles.every((role) => balances[role] !== undefined) ? otherRoles.map((role) => BigInt(balances[role] ?? "0")) : [],
    registered: keys,
    escrow: Boolean(deal.escrow),
    fusd,
    milestone: deal.escrow ? milestone : null,
    receipt: Boolean(deal.receipt),
    side,
  });
  const fundOpen = clientBalance !== undefined && (!clientCanPay || showFund || next.primary === "faucet");
  const qorexReady = qorexPresent();
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
              The panel keys cannot be paid. The phrases stay in this browser, and this page signs with them. Open the
              list if you want a backup before Forget.
            </p>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-ink">Show the five phrases</summary>
              <ul className="mt-3 grid gap-3">
                {ROLES.map((role) => (
                  <li key={role} className="rounded-lg bg-canvas px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] tracking-[0.08em] text-faint uppercase">{role}</p>
                      <CopyButton
                        copied={copied === `phrase-${role}`}
                        label={`the ${role} phrase`}
                        onClick={() => void copyText(`phrase-${role}`, deal.phrases[role])}
                      />
                    </div>
                    <p className="num mt-1 text-[13px] break-all text-ink">{deal.phrases[role]}</p>
                  </li>
                ))}
              </ul>
            </details>
            <div id="register" className="mt-4 flex scroll-mt-20 flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null || checking}
                onClick={() => void onRegister()}
                className={`inline-flex h-11 items-center rounded-lg px-4 text-sm font-medium transition-opacity disabled:opacity-40 ${
                  next.primary === "register"
                    ? "bg-action text-on-action hover:opacity-90"
                    : "bg-raise text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
                }`}
              >
                {checking && zone === "identities" ? "Checking the client" : "Register"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  ask(
                    "identities",
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
            {status("identities")}
            {copyError ? (
              <p className="mt-3 text-sm text-refused" role="alert">
                {copyError}
              </p>
            ) : null}

            <div id="fund" className="mt-5 scroll-mt-20 border-t border-line pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-sm font-medium text-ink">Fund the client</h3>
                {clientBalance === undefined ? (
                  <p className="text-[13px] text-muted" role="status">
                    Reading the balance
                  </p>
                ) : (
                  <p className="text-[13px] text-muted">
                    Client has <span className="num text-ink">{qor(BigInt(clientBalance))}</span> QOR
                  </p>
                )}
              </div>

              {clientCanPay && !showFund && next.primary !== "faucet" ? (
                <p className="mt-1 text-sm text-muted">
                  Enough for the fee.{" "}
                  <button
                    type="button"
                    onClick={() => setShowFund(true)}
                    className="text-ink underline underline-offset-4"
                  >
                    Add more QOR
                  </button>
                </p>
              ) : null}

              {fundOpen ? (
                <>
                  <p className="mt-1 max-w-[62ch] text-sm text-muted">
                    {next.fund === "fusd"
                      ? "The client has QOR. The faucet also gives fUSD. Paste this address and request fUSD."
                      : next.fund === "more"
                        ? "The pass needs more test QOR than the client holds. Paste this address into the faucet."
                        : clientCanPay
                          ? "Send more test QOR to this address."
                          : `Register needs ${FEE} uqor. A new identity is not on chain until test QOR arrives. Paste this address into the faucet.`}
                  </p>
                  <div className="mt-3 flex min-w-0 items-center gap-2 rounded-lg bg-canvas py-1.5 pr-1.5 pl-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
                    <p className="num min-w-0 flex-1 text-[13px] break-all text-ink">{accounts.client.cosmos}</p>
                    <CopyButton
                      copied={copied === "client-address"}
                      label="the client address"
                      onClick={() => void copyText("client-address", accounts.client.cosmos)}
                    />
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <a
                      href={FAUCET}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-opacity ${
                        next.primary === "faucet"
                          ? "bg-action text-on-action hover:opacity-90"
                          : "bg-raise text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
                      }`}
                    >
                      Open faucet
                      <OutIcon />
                    </a>
                    <button
                      type="button"
                      disabled={busy !== null || !qorexReady}
                      onClick={() =>
                        ask(
                          "fund",
                          "Fund the client from QoreX",
                          `QoreX sends ${qor(BigInt(qorAmount || "0"))} QOR to the client. QoreX shows the send and sets the fee.`,
                          async () => {
                            const sent = await fundFromQorex(accounts.client.cosmos, BigInt(qorAmount || "0"));
                            setNote(`Sent. ${sent.hash}`);
                            const next = await readBalances(accounts);
                            setBalances(next);
                            setSeen((n) => n + 1);
                          },
                        )
                      }
                      className="inline-flex h-11 items-center justify-center rounded-lg bg-raise px-4 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)] disabled:opacity-40"
                    >
                      {qorexReady ? `Fund ${qor(BigInt(qorAmount || "0"))} QOR with QoreX` : "QoreX is not installed"}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null || checking}
                      onClick={() => void checkFunds()}
                      className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm text-muted transition-colors hover:text-ink disabled:opacity-40"
                    >
                      {checking && zone === "fund" ? "Checking" : "Check again"}
                    </button>
                  </div>
                  <p className="mt-3 text-[13px] text-faint">
                    The faucet gives 100 QOR and 1000 fUSD a day. About {qor(suggestedQor())} QOR covers registration,
                    passing QOR to the other four, and the deal.
                  </p>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[13px] text-muted">QoreX amount and MetaMask</summary>
                    <div className="mt-3 grid gap-3">
                      <label className="text-[13px] text-muted">
                        QOR from QoreX, in uqor
                        <input
                          value={qorAmount}
                          onChange={(event) => setQorAmount(event.target.value.replace(/[^0-9]/g, ""))}
                          inputMode="numeric"
                          className="num mt-1 block h-11 w-full max-w-[16rem] rounded-lg bg-canvas px-3 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
                        />
                      </label>
                      <p className="max-w-[62ch] text-[13px] text-muted">
                        QoreX pays from its own QOR, with its own key. The faucet address above is the client, so it does not fill QoreX. QoreX does not sign a release.
                        MetaMask can add chain 9800 but cannot make the ML-DSA-87 signature, so it is not a party.
                      </p>
                      <div>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void run("fund", "Adding the testnet", async () => {
                              setWallet(await addMetaMask());
                            })
                          }
                          className="inline-flex h-11 items-center justify-center rounded-lg bg-raise px-4 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)] disabled:opacity-40"
                        >
                          Add chain 9800
                        </button>
                      </div>
                      {wallet ? (
                        <p className="num text-[13px] break-all text-muted">MetaMask {wallet}. It is not a party.</p>
                      ) : null}
                    </div>
                  </details>
                  {clientCanPay ? (
                    <button
                      type="button"
                      onClick={() => setShowFund(false)}
                      className="mt-3 text-[13px] text-muted underline underline-offset-4 hover:text-ink"
                    >
                      Hide
                    </button>
                  ) : null}
                </>
              ) : null}
              {status("fund")}
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
                    (next.primary === "client" || next.primary === "freelancer") && next.primary === role
                      ? "bg-action text-on-action"
                      : side === role
                        ? "bg-raise text-ink shadow-[inset_0_0_0_1px_var(--color-ink)]"
                        : "bg-raise text-muted shadow-[inset_0_0_0_1px_var(--color-line)]"
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
              It is not the sealed file.
            </p>
            <p className="mt-4 flex min-w-0 items-start gap-2 text-sm text-ink" role="status">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand ${next.primary === null && next.text === "Reading the deal." ? "animate-pulse" : ""}`} aria-hidden="true" />
              <span className="min-w-0">
                <span className="text-[12px] font-medium tracking-[0.08em] text-faint uppercase">Now. </span>
                {next.text}
              </span>
            </p>
            {deal.escrow ? <p className="num mt-3 text-[13px] break-all text-ink">Escrow {deal.escrow}</p> : null}
            {onChain ? <p className="mt-2 text-sm text-ink">{onChain}</p> : null}

            <div id="setup" className="mt-4 flex scroll-mt-20 flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Action
                primary={next.primary === "pass"}
                disabled={busy !== null || checking}
                label="Pass 2000000 uqor to each other identity"
                onClick={() =>
                  void gate(
                    "setup",
                    "client",
                    PASS_NEED,
                    "Pass QOR to the other four",
                    `The client sends 2000000 uqor to each of the other four. The fee is ${FEE} uqor.`,
                    async () => {
                      const hash = await passQor(
                        accounts.client,
                        ROLES.filter((role) => role !== "client").map((role) => accounts[role]),
                      );
                      setNote(hash);
                      setSeen((n) => n + 1);
                    },
                  )
                }
              />
              <Action
                primary={next.primary === "create"}
                disabled={busy !== null || checking || Boolean(deal.escrow)}
                label="Create the escrow"
                onClick={() =>
                  void (async () => {
                    if (!(await afford("client", WINDOW_FLOOR, "setup"))) return;
                    setBusy("Checking registration");
                    setZone("setup");
                    try {
                      const missing: Role[] = [];
                      for (const role of ROLES) {
                        if (!(await registered(accounts[role]))) missing.push(role);
                      }
                      if (missing.length > 0) {
                        setError({
                          problem: {
                            text:
                              missing.length === ROLES.length
                                ? "Register the five identities before creating the escrow."
                                : `Register these before creating the escrow: ${missing.join(", ")}.`,
                            raw: "",
                            quiet: false,
                            fix: "register",
                          },
                          retry: () => undefined,
                        });
                        return;
                      }
                    } catch (caught) {
                      setError({ problem: explain(messageOf(caught)), retry: () => undefined });
                      return;
                    } finally {
                      setBusy(null);
                    }
                    ask("setup", "Create the escrow", windowLine, async () => {
                      const escrow = await createEscrow(accounts);
                      keep({ ...deal, escrow });
                      setNote(escrow);
                      setSeen((n) => n + 1);
                    });
                  })()
                }
              />
              <Action
                primary={next.primary === "convert"}
                disabled={busy !== null || checking || !deal.escrow || side !== "client"}
                label="Convert 0.1 fUSD and fund"
                onClick={() =>
                  void (async () => {
                    if (!(await afford("client", FEE_UQOR * 3n, "setup"))) return;
                    let fusd: bigint;
                    try {
                      fusd = await readFusd(accounts.client.cosmos);
                    } catch (caught) {
                      setError({ problem: explain(messageOf(caught)), retry: () => undefined });
                      return;
                    }
                    if (fusd < PRACTICE_AMOUNT) {
                      setError({
                        problem: {
                          text: "The client has the QOR for the fee, but not 0.1 fUSD. The faucet gives 1000 fUSD a day.",
                          raw: "",
                          quiet: false,
                          fix: "fund",
                        },
                        retry: () => undefined,
                      });
                      return;
                    }
                    ask(
                      "setup",
                      "Convert and fund",
                      `The conversion fee is ${FEE} uqor, then open and close are ${FEE} uqor each. It converts 0.1 fUSD into the escrow.`,
                      async () => {
                        await convertAndFund(accounts.client, getAddress(deal.escrow!));
                        setNote("Funded.");
                        setSeen((n) => n + 1);
                      },
                    );
                  })()
                }
              />
            </div>
            {status("setup")}

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
                  <p className="mt-1.5 text-sm text-muted">{guideStep(stepState(deal, side, "receipt"), next.primary, "receipt")}</p>
                  <div className="mt-3">
                    <Action
                      primary={next.primary === "receipt"}
                      disabled={busy !== null || checking || !deal.escrow || side !== "client" || Boolean(deal.receipt)}
                      label="Receipt the sealed file"
                      onClick={() =>
                        void gate(
                          "steps",
                          "client",
                          WINDOW_FLOOR,
                          "Receipt the sealed file",
                          `The account is this browser’s client. ${windowLine} Registration, if this client is new, is one more fee of ${FEE} uqor. The window allows only 0x06b52afc4a151b0efa260e2adcdf2d477632cb56. The last record on this contract used 288262 gas and the price stops above 1320000 uqor. Courier does not carry the file.`,
                          async () => {
                            const receipt = await receiptSealedFile(accounts.client, getAddress(deal.escrow!));
                            keep({ ...deal, receipt });
                            setNote("Receipt stored. Courier did not carry the file.");
                            setSeen((n) => n + 1);
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
                  <p className="mt-1.5 text-sm text-muted">{guideStep(stepState(deal, side, "deliver"), next.primary, "deliver")}</p>
                  <div className="mt-3">
                    <Action
                      primary={next.primary === "deliver"}
                      disabled={busy !== null || checking || !deal.escrow || !deal.receipt || side !== "freelancer" || Boolean(deal.delivered)}
                      label="Deliver the sealed file"
                      onClick={() =>
                        void (async () => {
                          if (
                            !(await requireStatus(
                              "steps",
                              1,
                              "Convert 0.1 fUSD and fund, then deliver.",
                            ))
                          ) {
                            return;
                          }
                          await gate(
                            "steps",
                            "freelancer",
                            WINDOW_FLOOR,
                            "Deliver the sealed file",
                            `The account is this browser’s freelancer. ${windowLine} The window allows only this practice escrow and the price stops above 1320000 uqor. Courier does not carry the file.`,
                            async () => {
                              await deliverCommitment(
                                accounts.freelancer,
                                getAddress(deal.escrow!),
                                deal.receipt!.commitment as Hex,
                              );
                              keep({ ...deal, delivered: true });
                              setNote("The file was committed and receipted. Courier did not carry it.");
                              setSeen((n) => n + 1);
                            },
                          );
                        })()
                      }
                    />
                  </div>
                </li>
              </ol>
              {status("steps")}
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
                primary={next.primary === "release"}
                disabled={busy !== null || checking || !deal.escrow || side !== "client" || (!deal.delivered && milestone !== 2)}
                label="Release"
                onClick={() =>
                  void (async () => {
                    if (!(await requireStatus("settle", 2, "The freelancer delivers first."))) return;
                    await gate("settle", "client", WINDOW_FLOOR, "Release", windowLine, async () => {
                      const signature = await release(accounts.client, getAddress(deal.escrow!));
                      keep({ ...deal, releaseSignature: signature });
                      setNote("Released to the freelancer.");
                      setSeen((n) => n + 1);
                    });
                  })()
                }
              />
              <Action
                disabled={busy !== null || checking || !deal.escrow}
                label="Dispute"
                onClick={() =>
                  void (async () => {
                    if (!(await requireStatus("settle", 2, "Deliver the milestone first. Dispute is only open during the 120 second review."))) return;
                    await gate("settle", side, WINDOW_FLOOR, "Dispute", windowLine, async () => {
                      await dispute(actor, getAddress(deal.escrow!), side === "client");
                      setNote("Disputed.");
                      setSeen((n) => n + 1);
                    });
                  })()
                }
              />
              <Action
                primary={next.primary === "resolve"}
                disabled={busy !== null || checking || !deal.escrow}
                label="Resolve 50 / 50"
                  onClick={() =>
                    void (async () => {
                      if (!(await requireStatus("settle", 4, "Dispute the milestone first. Then the panel can split it."))) return;
                      await gate(
                        "settle",
                        side,
                        WINDOW_FLOOR,
                        "Resolve",
                        `${windowLine} Two panel keys sign. The pay still goes only to the two names.`,
                        async () => {
                          await resolveHalf(actor, accounts["arbiter-1"], accounts["arbiter-2"], getAddress(deal.escrow!));
                          setNote("Resolved at 5000 bps.");
                          setSeen((n) => n + 1);
                        },
                      );
                    })()
                  }
              />
              <Action disabled={busy !== null} label="Read the testnet" onClick={() => void refresh()} />
            </div>
            {status("settle")}

            <div className="mt-6 border-t border-line pt-5">
              <p className="max-w-[62ch] text-sm text-ink">These should fail. Run them once an escrow exists.</p>
              <h3 className="mt-4 text-[12px] font-medium tracking-[0.08em] text-faint uppercase">Try to steal the pay</h3>
              <p className="mt-2 max-w-[62ch] text-sm text-muted">
                This uses the client identity. The classical open is broadcast and has to fail, so there is no success
                hash. If the milestone is delivered, a second window carries a release signed with 4627 zero bytes. That
                signature is not ML-DSA-87. The window is opened with the registered key only so the refusal can be
                mined. The replay is read and not sent. Nothing here can name a new recipient.
              </p>
              <button
                type="button"
                disabled={busy !== null || checking || !deal.escrow}
                onClick={() =>
                  void gate(
                    "steal",
                    "client",
                    deal.delivered ? FEE_UQOR * 3n : FEE_UQOR,
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
              {status("steal")}
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
                    void run("refusals", "Reading the refusal", async () => {
                      setNote(await wrongMilestone(getAddress(deal.escrow!)));
                    })
                  }
                />
                <Action
                  disabled={busy !== null || !deal.escrow}
                  label="Early timeout"
                  onClick={() =>
                    void run("refusals", "Reading the refusal", async () => {
                      setNote(await earlyRelease(getAddress(deal.escrow!)));
                    })
                  }
                />
                <Action
                  disabled={busy !== null || !deal.escrow || !deal.releaseSignature}
                  label="Replay the release"
                  onClick={() =>
                    void run("refusals", "Reading the refusal", async () => {
                      setNote(await replayRelease(getAddress(deal.escrow!), deal.releaseSignature as Hex));
                    })
                  }
                />
                <Action
                  disabled={busy !== null || checking}
                  label="Classical open"
                  onClick={() =>
                    void gate(
                      "refusals",
                      side,
                      FEE_UQOR,
                      "Open a window with the classical key",
                      `The fee is ${FEE} uqor. The open has to be refused.`,
                      async () => {
                        const result = await classicalWindow(actor);
                        setNote(result.detail);
                      },
                    )
                  }
                />
              </div>
              {status("refusals")}
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
                disabled={busy !== null}
                onClick={() => {
                  if (sendLock.current) return;
                  sendLock.current = true;
                  void Promise.resolve(confirm.run()).finally(() => {
                    sendLock.current = false;
                  });
                }}
                className="inline-flex h-11 items-center rounded-lg bg-action px-4 text-sm font-medium text-on-action disabled:opacity-40"
              >
                {busy ? "Sending" : confirm.confirm}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setConfirm(null)}
                className="inline-flex h-11 items-center rounded-lg px-4 text-sm text-muted hover:text-ink disabled:opacity-40"
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

function StatusLine({
  busy,
  error,
  note,
  onDismiss,
  onFund,
  onPass,
  onRegister,
}: {
  busy: string | null;
  error: { problem: Problem; retry: () => void } | null;
  note: string | null;
  onDismiss: () => void;
  onFund: () => void;
  onPass: () => void;
  onRegister: () => void;
}) {
  if (busy) {
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-ink" role="status">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brand" aria-hidden="true" />
        {busy}
      </p>
    );
  }
  if (error) {
    const { problem, retry } = error;
    return (
      <div
        role="alert"
        className={`mt-3 min-w-0 rounded-lg px-3 py-2.5 text-sm ${
          problem.quiet ? "bg-raise text-muted" : "bg-refused-soft text-ink"
        }`}
      >
        <div className="flex items-start gap-2">
          {problem.quiet ? null : <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-refused" aria-hidden="true" />}
          <p className="min-w-0 flex-1">{problem.text}</p>
        </div>
        <div className={`mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] ${problem.quiet ? "" : "pl-3.5"}`}>
          {problem.fix === "retry" ? (
            <button type="button" onClick={retry} className="font-medium text-ink underline underline-offset-4">
              Try again
            </button>
          ) : null}
          {problem.fix === "fund" ? (
            <button type="button" onClick={onFund} className="font-medium text-ink underline underline-offset-4">
              Fund the client
            </button>
          ) : null}
          {problem.fix === "pass" ? (
            <button type="button" onClick={onPass} className="font-medium text-ink underline underline-offset-4">
              Pass QOR
            </button>
          ) : null}
          {problem.fix === "register" ? (
            <button type="button" onClick={onRegister} className="font-medium text-ink underline underline-offset-4">
              Register the identities
            </button>
          ) : null}
          <button type="button" onClick={onDismiss} className="text-muted hover:text-ink">
            Dismiss
          </button>
        </div>
        {problem.raw ? (
          <details className={`mt-2 ${problem.quiet ? "" : "pl-3.5"}`}>
            <summary className="cursor-pointer text-[12px] text-faint">Details</summary>
            <p className="num mt-1 text-[12px] break-all text-muted">{problem.raw}</p>
          </details>
        ) : null}
      </div>
    );
  }
  if (note) {
    return (
      <p className="num mt-3 text-[13px] break-all text-ink" role="status">
        {note}
      </p>
    );
  }
  return null;
}

function CopyButton({ copied, label, onClick }: { copied: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      onClick={onClick}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted transition-colors hover:bg-raise hover:text-ink"
    >
      <CopyIcon />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function OutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path d="M6 3.5h6.5V10M12.2 3.8 4 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4A1.3 1.3 0 0 0 3.8 10.5H5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function Action({ label, disabled, onClick, primary = false }: { label: string; disabled: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-sm transition-colors disabled:opacity-40 sm:w-auto ${
        primary
          ? "bg-action font-medium text-on-action enabled:hover:opacity-90"
          : "bg-raise text-ink shadow-[inset_0_0_0_1px_var(--color-line)] enabled:hover:bg-canvas"
      }`}
    >
      {label}
    </button>
  );
}

function PracticeLine({ client, freelancer }: { client: Address; freelancer: Address }) {
  return (
    <aside className="w-full self-start rounded-xl bg-surface px-4 py-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:px-5 lg:sticky lg:top-16 lg:z-10">
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
