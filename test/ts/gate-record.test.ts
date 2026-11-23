import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENE6_REPORT, WEB_RECORD, webRecord, type Scene6Report } from "../../scripts/lib/gate-record.js";

describe("receipt-gate web copy", () => {
  it("is null until scene 6 is ok, then equals the record built from deployments/", () => {
    const report = existsSync(SCENE6_REPORT) ? (JSON.parse(readFileSync(SCENE6_REPORT, "utf8")) as Scene6Report) : null;
    const copy = JSON.parse(readFileSync(WEB_RECORD, "utf8")) as unknown;
    expect(copy).toEqual(webRecord(report));
  });

  it("refuses an ok report with a missing field", () => {
    expect(() => webRecord({ network: "qorechain-diana", ok: true, ranAt: "2026-11-24T00:00:00Z", steps: [], transactions: [] })).toThrow(/escrowD/);
    expect(webRecord({ network: "qorechain-diana", ok: false, steps: [], transactions: [] })).toBeNull();
  });
});
