export type Party = {
  id: string; role: "customer" | "supplier" | "both"; name: string; address?: string;
  gstin?: string; pan?: string; phone?: string; email?: string; state?: string; updated?: number;
};
export type Item = {
  id: string; name: string; desc?: string; hsn?: string; unit?: string;
  rate: number; gst: number; updated?: number;
};
export type Line = {
  name: string; desc?: string; hsn?: string; qty: number; unit?: string; rate: number; gst: number; saveItem?: boolean;
};
export type Payment = { date: string; amount: number; mode?: string; ref?: string };
export type PartySnapshot = Pick<Party, "id" | "name"> & Partial<Omit<Party, "id" | "name">>;
export type Doc = {
  id: string; type: "INV" | "QTN" | "PUR"; no: string; date: string; due?: string;
  party: PartySnapshot | null; pos?: string; igst?: boolean; rcm?: boolean; shipSame?: boolean;
  shipName?: string; shipAddress?: string; lines: Line[]; terms?: string; notes?: string;
  payments?: Payment[]; ref?: string; cancelled?: boolean; convertedTo?: string;
  fromQtn?: string; created?: number; updated?: number; noRound?: boolean;
};
export type Company = {
  name: string; address: string; mobile: string; gstin: string; pan: string; email: string;
  state: string; stateCode: string; udyam: string; bankName: string; ifsc: string;
  account: string; bank: string; invPrefix: string; qtnPrefix: string; dueDays: number;
  qtnValidDays: number; terms: string; qtnTerms: string; lastBackupAt?: string;
};
export type Totals = {
  lines: Array<Line & { taxable: number; tax: number; total: number }>;
  taxable: number; tax: number; qty: number; byRate: Record<string, number>;
  gross: number; total: number; roundOff: number; received: number; balance: number;
};

const fyStart = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const fyLabel = `${fyStart}-${String(fyStart + 1).slice(2)}`;
export const DEFAULT_CO: Company = {
  name: "", address: "", mobile: "", gstin: "", pan: "", email: "",
  state: "", stateCode: "", udyam: "", bankName: "", ifsc: "", account: "", bank: "",
  invPrefix: `FY${fyLabel}/`, qtnPrefix: `QTN/${fyLabel}/`, dueDays: 7, qtnValidDays: 15,
  terms: "Payment is due as agreed. GST is charged as applicable.",
  qtnTerms: "This quotation is valid for 15 days. GST will be charged as applicable on the final invoice.",
};

export const STATES: Record<string, string> = {
  "01":"Jammu and Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh","05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan","09":"Uttar Pradesh","10":"Bihar","19":"West Bengal","20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh","24":"Gujarat","27":"Maharashtra","29":"Karnataka","30":"Goa","32":"Kerala","33":"Tamil Nadu","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur","15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam","26":"Dadra and Nagar Haveli and Daman and Diu","31":"Lakshadweep","34":"Puducherry","35":"Andaman and Nicobar Islands","36":"Telangana","37":"Andhra Pradesh","38":"Ladakh","97":"Other Territory",
};

export const TYPES = {
  INV: { label:"Tax Invoice", short:"Invoice", plural:"Invoices", tab:"inv", noLabel:"Invoice No.", dateLabel:"Invoice Date", due:"Due Date", partyRole:"customer", partyLabel:"Bill To" },
  QTN: { label:"Quotation", short:"Quotation", plural:"Quotations", tab:"qtn", noLabel:"Quotation No.", dateLabel:"Quotation Date", due:"Valid Till", partyRole:"customer", partyLabel:"Quotation For" },
  PUR: { label:"Purchase Bill", short:"Purchase", plural:"Purchases", tab:"pur", noLabel:"Supplier Bill No.", dateLabel:"Bill Date", due:"Due Date", partyRole:"supplier", partyLabel:"Supplier" },
} as const;

export const GST_RATES = [0, 5, 12, 18, 28, 40];
export const UNIT_OPTIONS = ["PCS","NOS","KG","TON","MTR","RMT","SQ.FT","SQ.MTR","SET","LTR","JOB","LOT","HRS","MANDAY"];
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const number = (value: unknown) => {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
export const format = (value: unknown) => {
  const n = round2(number(value));
  return n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
export const money = (value: unknown) => `₹ ${format(value)}`;
export const today = () => new Date().toLocaleDateString("en-CA");
export const addDays = (date: string, days: number) => {
  const result = new Date(`${date}T00:00:00`);
  result.setDate(result.getDate() + number(days));
  return result.toLocaleDateString("en-CA");
};
export const displayDate = (date?: string) => date ? date.split("-").reverse().join("/") : "";
export const makeId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function calc(doc: Pick<Doc, "lines" | "payments" | "rcm" | "noRound">): Totals {
  let taxable = 0, tax = 0, qty = 0;
  const byRate: Record<string, number> = {};
  const lines = (doc.lines || []).map(line => {
    const amount = round2(number(line.qty) * number(line.rate));
    const lineTax = round2(amount * number(line.gst) / 100);
    taxable += amount; tax += lineTax; qty += number(line.qty);
    const key = String(number(line.gst));
    byRate[key] = round2((byRate[key] || 0) + lineTax);
    return { ...line, taxable: amount, tax: lineTax, total: round2(amount + lineTax) };
  });
  taxable = round2(taxable); tax = round2(tax);
  const gross = doc.rcm ? taxable : round2(taxable + tax);
  const total = doc.noRound ? gross : Math.round(gross);
  const received = round2((doc.payments || []).reduce((sum, payment) => sum + number(payment.amount), 0));
  return { lines, taxable, tax, qty, byRate, gross, total, roundOff: round2(total - gross), received, balance: round2(total - received) };
}

function words(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (!n) return "Zero";
  const small = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const two = (x: number) => x < 20 ? small[x] : tens[Math.floor(x / 10)] + (x % 10 ? ` ${small[x % 10]}` : "");
  const three = (x: number) => x >= 100 ? `${small[Math.floor(x / 100)]} Hundred${x % 100 ? ` ${two(x % 100)}` : ""}` : two(x);
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${crore >= 1000 ? words(crore) : three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(" ");
}
export function amountWords(total: number) {
  const rupees = Math.floor(total), paise = Math.round((total - rupees) * 100);
  return `${words(rupees)} Rupees${paise ? ` and ${words(paise)} Paise` : ""}`;
}

export function documentStatus(doc: Doc, now = today()) {
  const totals = calc(doc);
  if (doc.cancelled) return ["Cancelled", "neutral"] as const;
  if (doc.type === "QTN") return doc.convertedTo ? ["Converted", "paid"] as const : (doc.due && doc.due < now ? ["Expired", "neutral"] as const : ["Open", "due"] as const);
  if (totals.balance <= 0) return ["Paid", "paid"] as const;
  if (doc.due && doc.due < now) return [totals.received > 0 ? "Part paid · overdue" : "Overdue", "overdue"] as const;
  return [totals.received > 0 ? "Part paid" : doc.type === "PUR" ? "Unpaid" : "Due", "due"] as const;
}

export function nextNumber(type: Doc["type"], company: Company, docs: Doc[]) {
  const prefix = type === "INV" ? company.invPrefix : type === "QTN" ? company.qtnPrefix : "";
  const highest = docs.reduce((max, doc) => {
    if (doc.type !== type || !String(doc.no).startsWith(prefix)) return max;
    const sequence = Number.parseInt(String(doc.no).slice(prefix.length), 10);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `${prefix}${highest + 1}`;
}

export type Period = { key: string; label: string; from: string; to: string };
export function periods(now = new Date()) {
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const result: { month: Period[]; quarter: Period[]; fy: Period[] } = { month: [], quarter: [], fy: [] };
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let year = fy; year >= fy - 1; year--) {
    for (let m = 14; m >= 3; m--) {
      const y = m > 11 ? year + 1 : year, month = m % 12, start = new Date(y, month, 1);
      if (start > now) continue;
      result.month.push({ key: `m${y}-${pad(month + 1)}`, label: `${months[month]} ${y}`, from: start.toLocaleDateString("en-CA"), to: new Date(y, month + 1, 0).toLocaleDateString("en-CA") });
    }
    for (const [month, label] of [[12,"Q4 Jan–Mar"],[9,"Q3 Oct–Dec"],[6,"Q2 Jul–Sep"],[3,"Q1 Apr–Jun"]] as const) {
      const y = month > 11 ? year + 1 : year, m = month % 12, start = new Date(y, m, 1);
      if (start > now) continue;
      result.quarter.push({ key: `q${year}-${month}`, label: `${label} ${year}-${String(year + 1).slice(2)}`, from: start.toLocaleDateString("en-CA"), to: new Date(y, m + 3, 0).toLocaleDateString("en-CA") });
    }
    result.fy.push({ key: `f${year}`, label: `FY ${year}-${String(year + 1).slice(2)}`, from: `${year}-04-01`, to: `${year + 1}-03-31` });
  }
  return result;
}

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const validGstin = (value?: string) => GSTIN_RE.test(String(value || "").toUpperCase().trim());
export function stateOfGstin(gstin?: string) {
  const code = String(gstin || "").slice(0, 2);
  return STATES[code] ? { code, name: STATES[code] } : null;
}
const UQC: Record<string, string> = { PCS:"PCS", NOS:"PCS", KG:"KGS", KGS:"KGS", MTR:"MTR", RMT:"MTR", "SQ.FT":"SQF", "SQ.MTR":"SQM", SET:"SET", TON:"TON", MT:"MTS", LTR:"LTR" };
const uqcOf = (line: Line) => String(line.hsn || "").startsWith("99") ? "NA" : UQC[String(line.unit || "").toUpperCase().trim()] || "OTH";
type Tax = { taxable: number; i: number; c: number; s: number };
const zero = (): Tax => ({ taxable: 0, i: 0, c: 0, s: 0 });
export type GSTInvoiceRow = Tax & { gstin: string; name: string; no: string; date: string; value: number; pos: string; rate: number };
export type GSTB2CSummary = Tax & { pos: string; rate: number; type: string };
export type GSTHSNRow = Tax & { hsn: string; desc: string; uqc: string; rate: number; qty: number };
export type GSTDocumentSeries = { series: string; from: string | null; to: string | null; fromN: number; toN: number; total: number; cancelled: number };
type GSTInterstateRow = Tax & { pos: string };
type GSTPurchaseRow = Tax & { doc: Doc; eligibleSupplier: boolean };

function addTax<T extends object>(a: Tax & T, b: Partial<Tax>): Tax & T {
  a.taxable = round2(a.taxable + (b.taxable || 0)); a.i = round2(a.i + (b.i || 0));
  a.c = round2(a.c + (b.c || 0)); a.s = round2(a.s + (b.s || 0)); return a;
}
function splitTax(taxable: number, rate: number, inter: boolean) {
  const tax = round2(taxable * number(rate) / 100);
  return inter ? { i: tax, c: 0, s: 0 } : { i: 0, c: round2(tax / 2), s: round2(tax - round2(tax / 2)) };
}
function rateGroups(doc: Doc) {
  const groups: Record<string, Tax> = {};
  calc(doc).lines.forEach(line => {
    const key = String(number(line.gst));
    groups[key] = addTax(groups[key] || zero(), { taxable: line.taxable, ...splitTax(line.taxable, line.gst, !!doc.igst) });
  });
  return groups;
}
export type GSTReport = ReturnType<typeof gst3b>;

export function gst1(docs: Doc[], company: Company, period: Period) {
  const invoices = docs.filter(doc => doc.type === "INV" && doc.date >= period.from && doc.date <= period.to);
  const live = invoices.filter(doc => !doc.cancelled);
  const report = {
    b2b: [] as GSTInvoiceRow[], b2cl: [] as GSTInvoiceRow[],
    b2cs: {} as Record<string, GSTB2CSummary>, nil: { interReg:0, intraReg:0, interUnreg:0, intraUnreg:0 },
    hsnB2B: {} as Record<string, GSTHSNRow>, hsnB2C: {} as Record<string, GSTHSNRow>,
    docs: {} as Record<string, GSTDocumentSeries>, warn: [] as string[],
  };
  live.forEach(doc => {
    const totals = calc(doc), registered = validGstin(doc.party?.gstin), state = doc.party?.gstin ? stateOfGstin(doc.party.gstin) : null;
    const posName = state?.name || doc.pos || company.state;
    const posCode = state?.code || Object.keys(STATES).find(code => STATES[code].toLowerCase() === String(posName).trim().toLowerCase()) || company.stateCode;
    const inter = !!doc.igst;
    if (doc.party?.gstin && !registered) report.warn.push(`Invoice ${doc.no}: GSTIN “${doc.party.gstin}” looks invalid, so it is reported as B2C.`);
    if (!inter && posCode !== company.stateCode) report.warn.push(`Invoice ${doc.no}: place of supply is ${posName} but CGST + SGST was charged. Check the IGST setting.`);
    if (inter && posCode === company.stateCode) report.warn.push(`Invoice ${doc.no}: IGST charged on a supply within ${posName}. Check the IGST setting.`);
    Object.entries(rateGroups(doc)).forEach(([rate, tax]) => {
      if (number(rate) === 0) { report.nil[(inter ? "inter" : "intra") + (registered ? "Reg" : "Unreg") as keyof typeof report.nil] += tax.taxable; return; }
      const row = { gstin: registered ? doc.party?.gstin?.toUpperCase() || "" : "", name: doc.party?.name || "", no: doc.no, date: doc.date, value: totals.total, pos: `${posCode}-${posName}`, rate: number(rate), ...tax };
      if (registered) report.b2b.push(row);
      else if (inter && totals.total > 100000) report.b2cl.push(row);
      else {
        const key = `${posCode}|${rate}|${inter ? "Inter" : "Intra"}`;
        report.b2cs[key] = addTax(report.b2cs[key] || { ...zero(), pos: row.pos, rate: number(rate), type: inter ? "Inter-state" : "Intra-state" }, tax);
      }
    });
    totals.lines.forEach(line => {
      if (!String(line.hsn || "").trim()) report.warn.push(`Invoice ${doc.no}: “${line.name}” has no HSN/SAC code. Add it so Table 12 is complete.`);
      const hsn = String(line.hsn || "").trim() || "(no HSN)", uqc = uqcOf(line), key = `${hsn}|${number(line.gst)}|${uqc}`;
      const target = registered ? report.hsnB2B : report.hsnB2C;
      const tax = { taxable: line.taxable, ...splitTax(line.taxable, line.gst, inter) };
      target[key] = addTax(target[key] || { ...zero(), hsn, desc: line.name, uqc, rate: number(line.gst), qty: 0 }, tax);
      target[key].qty = round2(target[key].qty + (uqc === "NA" ? 0 : number(line.qty)));
    });
  });
  invoices.forEach(doc => {
    const match = String(doc.no).match(/^(.*?)(\d+)$/), prefix = match ? match[1] : doc.no, sequence = match ? Number.parseInt(match[2], 10) : null;
    const group = report.docs[prefix] ||= { series: prefix, from: null, to: null, fromN: Infinity, toN: -Infinity, total: 0, cancelled: 0 };
    group.total++; if (doc.cancelled) group.cancelled++;
    if (sequence !== null) {
      if (sequence < group.fromN) { group.fromN = sequence; group.from = doc.no; }
      if (sequence > group.toN) { group.toN = sequence; group.to = doc.no; }
    } else { group.from ||= doc.no; group.to = doc.no; }
  });
  report.warn = [...new Set(report.warn)];
  const sum = (rows: Array<Partial<Tax>>): Tax => rows.reduce<Tax>((acc, row) => {
    addTax(acc, row);
    return acc;
  }, zero());
  const totals = { b2b: sum(report.b2b), b2cl: sum(report.b2cl), b2cs: sum(Object.values(report.b2cs)), hsn: sum([...Object.values(report.hsnB2B), ...Object.values(report.hsnB2C)]) };
  const all = addTax(addTax(addTax(zero(), totals.b2b), totals.b2cl), totals.b2cs);
  return { ...report, totals: { ...totals, all }, count: { b2b: new Set(report.b2b.map(row => row.no)).size, b2cl: new Set(report.b2cl.map(row => row.no)).size, invoices: live.length, cancelled: invoices.length - live.length } };
}

function setoff(liability: { i: number; c: number; s: number }, credit: { i: number; c: number; s: number }) {
  const remaining = { ...liability }, credits = { ...credit };
  const used = { i: { i:0, c:0, s:0 }, c: { i:0, c:0, s:0 }, s: { i:0, c:0, s:0 } };
  const applyCredit = (from: "i" | "c" | "s", to: "i" | "c" | "s", cap = Infinity) => {
    const amount = round2(Math.min(credits[from], remaining[to], cap));
    if (amount > 0) { credits[from] = round2(credits[from] - amount); remaining[to] = round2(remaining[to] - amount); used[from][to] = round2(used[from][to] + amount); }
  };
  applyCredit("i", "i"); applyCredit("i", "c", Math.max(0, remaining.c - credits.c)); applyCredit("i", "s", Math.max(0, remaining.s - credits.s)); applyCredit("i", "c"); applyCredit("i", "s");
  applyCredit("c", "c"); applyCredit("c", "i"); applyCredit("s", "s"); applyCredit("s", "i");
  return { used, cash: remaining, balance: credits };
}

export function gst3b(docs: Doc[], company: Company, period: Period) {
  const g1 = gst1(docs, company, period), output = g1.totals.all;
  const nilOutput = round2(Object.values(g1.nil).reduce((sum, amount) => sum + amount, 0));
  const interstate: Record<string, GSTInterstateRow> = {};
  [...g1.b2cl, ...Object.values(g1.b2cs).filter(row => row.type === "Inter-state")].forEach(row => {
    interstate[row.pos] = addTax(interstate[row.pos] || { ...zero(), pos: row.pos }, row);
  });
  const purchases = docs.filter(doc => doc.type === "PUR" && doc.date >= period.from && doc.date <= period.to && !doc.cancelled);
  const rcm = zero(), otherItc = zero(), noItc = zero(), exempt = { inter:0, intra:0 }, register: GSTPurchaseRow[] = [], warn: string[] = [];
  purchases.forEach(doc => {
    const eligibleSupplier = validGstin(doc.party?.gstin);
    Object.entries(rateGroups(doc)).forEach(([rate, tax]) => {
      if (number(rate) === 0) exempt[doc.igst ? "inter" : "intra"] += tax.taxable;
      else if (doc.rcm) addTax(rcm, tax);
      else if (eligibleSupplier) addTax(otherItc, tax);
      else addTax(noItc, tax);
    });
    if (!doc.rcm && !eligibleSupplier && calc(doc).tax > 0) warn.push(`Purchase ${doc.no} from ${doc.party?.name}: no valid supplier GSTIN, so its GST is not counted as ITC.`);
    const group = Object.values(rateGroups(doc)).reduce((acc, tax) => addTax(acc, tax), zero());
    register.push({ doc, ...group, eligibleSupplier });
  });
  const itc = addTax(addTax(zero(), rcm), otherItc);
  const offset = setoff({ i: output.i, c: output.c, s: output.s }, { i: itc.i, c: itc.c, s: itc.s });
  return {
    g1, output, nilOutput, interstate: Object.values(interstate), rcm, otherItc, itc, noItc, exempt, register, warn, offset,
    cash: { i: round2(offset.cash.i + rcm.i), c: round2(offset.cash.c + rcm.c), s: round2(offset.cash.s + rcm.s) },
  };
}
