"use client";

import { useEffect, useState } from "react";
import { browserRpc } from "@/lib/rpc";
import { escrowCalls, factoryCalls, readPayees, type EscrowPayees } from "@/lib/third-name";

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function partyLine(party: "client" | "freelancer" | "other"): string {
  if (party === "client") return "The client stored on this escrow.";
  if (party === "freelancer") return "The freelancer stored on this escrow.";
  return "Not the client or the freelancer stored on this escrow.";
}

export function NoThirdName({ embedded = false }: { embedded?: boolean }) {
  const [reads, setReads] = useState<EscrowPayees[] | null>(null);

  useEffect(() => {
    let cancel = false;
    readPayees(browserRpc())
      .then((rows) => {
        if (!cancel) setReads(rows);
      })
      .catch(() => {
        if (!cancel) setReads([]);
      });
    return () => {
      cancel = true;
    };
  }, []);

  return (
    <section className={embedded ? "min-w-0" : "min-w-0 rounded-xl bg-surface px-4 py-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:px-5"}>
      <h3 className="text-[13px] tracking-[0.08em] text-faint uppercase">No third name</h3>
      <p className="mt-2 text-[13px] text-muted">
        The only address parameter on a state-changing escrow function is who on resolve. Signs the split. Is not paid.
      </p>
      <ul className="mt-3 grid min-w-0 gap-1.5">
        {escrowCalls.map((call) => (
          <li key={call.name} className="min-w-0 text-[13px] break-words text-ink">
            <span className="num">{call.name}</span>
            {call.addresses.length > 0 ? <span className="text-muted"> · who · Signs the split. Is not paid.</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] text-muted">Factory create names the client, the freelancer, and the arbiters once.</p>
      <ul className="mt-2 grid min-w-0 gap-1.5">
        {factoryCalls.map((call) => (
          <li key={call.name} className="min-w-0 text-[13px] break-words text-ink">
            <span className="num">{call.name}</span>
            <span className="text-muted"> · client, freelancer, arbiters. The token is named once. It is not paid.</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid min-w-0 gap-3">
        {reads === null ? <p className="text-[13px] text-muted">Reading the testnet.</p> : null}
        {reads !== null && reads.length === 0 ? <p className="text-[13px] text-muted">The check could not be read.</p> : null}
        {reads?.map((item) => (
          <div key={item.escrow} className="min-w-0">
            <p className="text-[13px] text-faint">
              Escrow {item.label}{" "}
              <span className="num break-all text-muted" title={item.escrow}>
                {short(item.escrow)}
              </span>
            </p>
            {item.state === "could-not-read" ? <p className="mt-1 text-[13px] text-muted">The check could not be read.</p> : null}
            {item.state === "read" ? (
              <>
                <p className="mt-1 min-w-0 text-[13px] break-words text-muted">
                  Client{" "}
                  <span className="num break-all text-ink" title={item.client}>
                    {short(item.client)}
                  </span>
                  . Freelancer{" "}
                  <span className="num break-all text-ink" title={item.freelancer}>
                    {short(item.freelancer)}
                  </span>
                  .
                </p>
                {item.rows.length === 0 ? (
                  <p className="mt-1 text-[13px] text-muted">These receipts moved no fUSD out of this escrow.</p>
                ) : (
                  <ul className="mt-1 grid min-w-0 gap-1.5">
                    {item.rows.map((row, index) => (
                      <li key={`${row.to}-${index}`} className="min-w-0 text-[13px] break-words text-muted">
                        <span className="num break-all text-ink" title={row.to}>
                          {short(row.to)}
                        </span>{" "}
                        <span className="num">{row.value.toString()}</span> base units. {partyLine(row.party)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-faint">
        This does not check the bytecode against the source. The Foundry tests and docs/AUDIT.md do. It reads only the recorded receipts.
      </p>
    </section>
  );
}
