"use client";

import { useState } from "react";
import { TWO_ARBITER_HASH, filesForScene, type SealedFile } from "@/lib/sealed";
import { readSealed, type SealRead } from "@/lib/sealed-check";
import { NETWORK } from "@/lib/verify";

function short(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

export function SealedFiles({ sceneId }: { sceneId: string }) {
  const files = filesForScene(sceneId);
  if (files.length === 0) return null;
  return (
    <section className="mt-6 rounded-xl bg-canvas p-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-5">
      <h3 className="text-[18px] tracking-[-0.03em]">The sealed file</h3>
      <p className="mt-2 max-w-[62ch] text-sm text-muted">
        The page proves which file was delivered. It cannot open it, and neither can anyone holding one share.
      </p>
      <div className="mt-4 grid gap-4">
        {files.map((file) => (
          <FileCard key={`${file.escrow}-${file.milestone}`} file={file} showResolve={sceneId === "dispute"} />
        ))}
      </div>
    </section>
  );
}

function FileCard({ file, showResolve }: { file: SealedFile; showResolve: boolean }) {
  const [read, setRead] = useState<SealRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setRead(await readSealed(file, showResolve ? TWO_ARBITER_HASH : null));
    } catch (caught) {
      setRead(null);
      setError(caught instanceof Error ? caught.message : NETWORK);
    } finally {
      setBusy(false);
    }
  }

  const eventMatch = read?.event !== "missing" && read?.event.toLowerCase() === file.commitment.toLowerCase();
  const storedMatch = read?.stored !== "missing" && read?.stored.toLowerCase() === file.commitment.toLowerCase();

  return (
    <article className="min-w-0">
      <p className="text-[13px] text-faint">
        {file.fileName} · milestone {file.milestone.toString()}
      </p>
      <p className="num mt-1 text-[13px] break-all" title={file.commitment}>
        <span className="sm:hidden">{short(file.commitment)}</span>
        <span className="hidden sm:inline">{file.commitment}</span>
      </p>
      <p className="mt-3 text-sm">Three sealed envelopes, one per arbiter.</p>
      <ul className="mt-2 grid gap-1">
        {file.envelopes.map((hash, index) => (
          <li key={hash} className="num text-[12px] break-all text-muted" title={hash}>
            Arbiter {index + 1} · <span className="sm:hidden">{short(hash)}</span>
            <span className="hidden sm:inline">{hash}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void check()}
        disabled={busy}
        className="mt-3 inline-flex h-10 items-center rounded-lg bg-raise px-3 text-sm shadow-[inset_0_0_0_1px_var(--color-line)] disabled:opacity-40"
      >
        Check this file
      </button>
      {busy ? (
        <p role="status" className="mt-2 text-sm">
          Reading the delivery.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-refused">
          {error}{" "}
          <button type="button" className="underline" onClick={() => void check()}>
            Retry
          </button>
        </p>
      ) : null}
      {read ? (
        <div className="mt-3 grid gap-2 text-sm">
          <p className={eventMatch ? "text-ink" : "text-refused"}>
            {eventMatch ? "The Delivered event stores this commitment." : "The Delivered event does not store this commitment."}
          </p>
          <p className={storedMatch ? "text-ink" : "text-refused"}>
            {storedMatch ? "milestone() stores this commitment." : "milestone() does not store this commitment."}
          </p>
          <p className="break-words text-muted">{read.deliver.lines.find((line) => line.id === "signature")?.reason}</p>
          {read.resolve ? (
            <p className="break-words text-muted">
              Two arbiters. {read.resolve.lines.find((line) => line.id === "signature")?.reason}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
