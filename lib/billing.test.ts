import assert from "node:assert/strict";
import { test } from "node:test";
import { amountWords, calc, DEFAULT_CO, gst1, gst3b, nextNumber, periods, type Doc } from "./billing";

test("calculates taxable value, GST, round-off, payment and balance", () => {
  const result = calc({
    lines: [{ name: "Gate", qty: 2, rate: 1000, gst: 18 }],
    payments: [{ date: "2026-10-01", amount: 500 }],
  });
  assert.equal(result.taxable, 2000);
  assert.equal(result.tax, 360);
  assert.equal(result.total, 2360);
  assert.equal(result.balance, 1860);
});

test("reverse-charge purchase total excludes GST from payable bill total", () => {
  const result = calc({ rcm: true, lines: [{ name: "Freight", qty: 1, rate: 1000, gst: 5 }] });
  assert.equal(result.tax, 50);
  assert.equal(result.total, 1000);
});

test("assigns the next number within its configured prefix", () => {
  const docs = [
    { id: "1", type: "INV", no: "FY2026-27/3" },
    { id: "2", type: "INV", no: "FY2026-27/8" },
    { id: "3", type: "QTN", no: "QTN/2026-27/90" },
  ] as Doc[];
  assert.equal(nextNumber("INV", DEFAULT_CO, docs), `${DEFAULT_CO.invPrefix}9`);
});

test("creates a GSTR-1 B2C summary and warns when the HSN is missing", () => {
  const docs: Doc[] = [{
    id: "inv", type: "INV", no: "INV/1", date: "2026-10-10", party: { id: "p", name: "Walk-in", role: "customer" },
    pos: "Maharashtra", igst: false, lines: [{ name: "Fabrication", qty: 1, rate: 1000, gst: 18 }],
  }];
  const report = gst1(docs, { ...DEFAULT_CO, state: "Maharashtra", stateCode: "27" }, periods(new Date("2026-10-21")) .month.find(item => item.key === "m2026-10")!);
  assert.equal(Object.keys(report.b2cs).length, 1);
  assert.equal(report.totals.all.taxable, 1000);
  assert.ok(report.warn.some(warning => warning.includes("no HSN/SAC")));
});

test("includes eligible purchase credit and calculates the cash GST balance", () => {
  const docs: Doc[] = [
    { id: "s", type: "INV", no: "I1", date: "2026-10-10", party: { id: "p", name: "Customer", role: "customer" }, pos: "Maharashtra", lines: [{ name: "Gate", qty: 1, rate: 1000, gst: 18 }] },
    { id: "p", type: "PUR", no: "P1", date: "2026-10-10", party: { id: "s", name: "Supplier", role: "supplier", gstin: "27AABCU9603R1ZM" }, lines: [{ name: "Material", qty: 1, rate: 200, gst: 18 }] },
  ];
  const report = gst3b(docs, { ...DEFAULT_CO, state: "Maharashtra", stateCode: "27" }, periods(new Date("2026-10-21")).month.find(item => item.key === "m2026-10")!);
  assert.equal(report.itc.c + report.itc.s, 36);
  assert.equal(report.cash.c + report.cash.s, 144);
});

test("renders Indian currency amount in words", () => {
  assert.equal(amountWords(1234), "One Thousand Two Hundred Thirty Four Rupees");
});
