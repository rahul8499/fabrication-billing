"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import PwaInstallButton from "@/components/pwa-install-button";
import {
  addDays, amountWords, calc, DEFAULT_CO, displayDate, documentStatus, format, GST_RATES,
  gst3b, makeId, money, nextNumber, number, periods, round2, stateOfGstin, today,
  TYPES, UNIT_OPTIONS, type Company, type Doc, type GSTB2CSummary, type GSTDocumentSeries, type GSTHSNRow, type GSTReport, type Item, type Line, type Party, type Period,
} from "@/lib/billing";

type Tab = "dash" | "inv" | "qtn" | "pur" | "gst" | "parties" | "items" | "settings";
type Database = { company?: Partial<Company>; parties?: Record<string, Party>; items?: Record<string, Item>; docs?: Record<string, Doc> };
type GSTSub = "r1" | "r3b" | "pr";
type GSTPeriodType = "month" | "quarter" | "fy";

const NAV: Array<[Tab, string, string]> = [
  ["dash", "Dashboard", "⌂"], ["inv", "Invoices", "▤"], ["qtn", "Quotations", "◷"],
  ["pur", "Purchases", "⇩"], ["gst", "GST Reports", "%"], ["parties", "Customers & Suppliers", "♙"],
  ["items", "Items", "▦"], ["settings", "Settings", "⚙"],
];
const EMPTY_LINE = (): Line => ({ name: "", desc: "", hsn: "", qty: 1, unit: "PCS", rate: 0, gst: 18, saveItem: true });
const todayFy = () => new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const newDoc = (type: Doc["type"], company: Company, docs: Doc[]): Doc => {
  const date = today();
  return {
    id: makeId("d"), type, no: type === "PUR" ? "" : nextNumber(type, company, docs), date,
    due: type === "INV" ? addDays(date, company.dueDays) : type === "QTN" ? addDays(date, company.qtnValidDays) : "",
    party: null, pos: company.state, igst: false, rcm: false, shipSame: true,
    shipName: "", shipAddress: "", lines: [EMPTY_LINE()],
    terms: type === "INV" ? company.terms : type === "QTN" ? company.qtnTerms : "",
    notes: "", payments: [], ref: "",
  };
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function csvDownload(filename: string, rows: unknown[][]) {
  const quote = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = "\uFEFF" + rows.map(row => row.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

function downloadPdf(doc: Doc, company: Company) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const totals = calc(doc), party = doc.party;
  const type = TYPES[doc.type];
  const red: [number, number, number] = [15, 118, 110];
  const left = 14, right = 196, width = right - left;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(17); pdf.setTextColor(...red);
  pdf.text(company.name || "RS Fabrication", left, 19);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(40);
  let y = 26;
  [company.address, company.mobile && `Mobile: ${company.mobile}`, company.gstin && `GSTIN: ${company.gstin}`, company.pan && `PAN: ${company.pan}`, company.email].filter(Boolean).forEach(line => {
    pdf.text(String(line), left, y); y += 4.5;
  });
  y += 3;
  pdf.setDrawColor(...red); pdf.setLineWidth(1); pdf.line(left, y, right, y); y += 8;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.setTextColor(20);
  pdf.text(doc.type === "INV" ? "TAX INVOICE" : doc.type === "QTN" ? "QUOTATION" : "PURCHASE BILL", left, y);
  if (doc.cancelled) { pdf.setTextColor(...red); pdf.text("CANCELLED", right, y, { align: "right" }); pdf.setTextColor(20); }
  y += 7; pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
  pdf.text(`${type.noLabel} ${doc.no}     ${type.dateLabel}: ${displayDate(doc.date)}${doc.due ? `     ${type.due}: ${displayDate(doc.due)}` : ""}`, left, y); y += 8;
  const address = (label: string, name?: string, text?: string, gstin?: string, pan?: string, x = left) => {
    let lineY = y;
    pdf.setFont("helvetica", "bold"); pdf.text(label, x, lineY); lineY += 5;
    pdf.setFont("helvetica", "bold"); pdf.text(name || "", x, lineY); lineY += 5;
    pdf.setFont("helvetica", "normal");
    if (text) { const addressLines = pdf.splitTextToSize(text, 80); pdf.text(addressLines, x, lineY); lineY += addressLines.length * 4.5; }
    if (gstin) { pdf.text(`GSTIN: ${gstin}`, x, lineY); lineY += 4.5; }
    if (pan) { pdf.text(`PAN: ${pan}`, x, lineY); lineY += 4.5; }
    return lineY;
  };
  const companyY = doc.type === "PUR"
    ? address("BILLED TO (US)", company.name, company.address, company.gstin, company.pan)
    : address(type.partyLabel.toUpperCase(), party?.name, party?.address, party?.gstin, party?.pan);
  let otherY = y;
  if (doc.type !== "PUR" && doc.type === "INV") otherY = address("SHIP TO", doc.shipSame === false ? doc.shipName : party?.name, doc.shipSame === false ? doc.shipAddress : party?.address, undefined, undefined, left + 100);
  if (doc.type === "PUR" && doc.ref) otherY = address("OUR ENTRY REF.", doc.ref, "", undefined, undefined, left + 100);
  y = Math.max(companyY, otherY) + 5;
  const showHsn = totals.lines.some(line => line.hsn);
  autoTable(pdf, {
    startY: y, margin: { left, right: 14 },
    head: [["ITEMS", ...(showHsn ? ["HSN/SAC"] : []), "QTY.", "RATE", "TAX", "AMOUNT"]],
    body: [
      ...totals.lines.map(line => [line.name + (line.desc ? `\n${line.desc}` : ""), ...(showHsn ? [line.hsn || ""] : []), `${format(line.qty)} ${line.unit || ""}`, format(line.rate), `${format(line.tax)} (${format(line.gst)}%)`, format(line.total)]),
      ["SUBTOTAL", ...(showHsn ? [""] : []), format(totals.qty), "", format(totals.tax), format(totals.gross)],
    ],
    theme: "grid",
    headStyles: { fillColor: red },
    styles: { fontSize: 8, cellPadding: 2 },
  });
  y = ((pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y) + 9;
  if (y > 235) { pdf.addPage(); y = 20; }
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
  pdf.text(`Taxable amount: ${money(totals.taxable)}`, left, y); y += 5;
  Object.entries(totals.byRate).filter(([rate]) => Number(rate) > 0).forEach(([rate, tax]) => {
    if (doc.igst) { pdf.text(`IGST @${rate}%: ${money(tax)}`, left, y); y += 5; }
    else {
      pdf.text(`CGST @${Number(rate) / 2}%: ${money(round2(tax / 2))}`, left, y); y += 5;
      pdf.text(`SGST @${Number(rate) / 2}%: ${money(round2(tax - round2(tax / 2)))}`, left, y); y += 5;
    }
  });
  if (totals.roundOff) { pdf.text(`Round off: ${money(totals.roundOff)}`, left, y); y += 5; }
  pdf.setFont("helvetica", "bold"); pdf.text(`TOTAL: ${money(totals.total)}`, left, y); y += 6;
  pdf.setFont("helvetica", "normal");
  if (doc.type !== "QTN") { pdf.text(`${doc.type === "PUR" ? "Paid" : "Received"}: ${money(totals.received)}     Balance: ${money(totals.balance)}`, left, y); y += 6; }
  pdf.text(pdf.splitTextToSize(`Amount in words: ${amountWords(totals.total)}`, width), left, y); y += 10;
  const terms = doc.type === "PUR" ? doc.notes : `${doc.terms || ""}${doc.notes ? `\nNotes: ${doc.notes}` : ""}`;
  if (terms) pdf.text(pdf.splitTextToSize(terms, width), left, y);
  if (doc.type !== "PUR") {
    const bank = [company.bankName, company.account && `Account: ${company.account}`, company.ifsc && `IFSC: ${company.ifsc}`, company.bank].filter(Boolean).join(" · ");
    if (bank) pdf.text(pdf.splitTextToSize(`Bank details: ${bank}`, width), left, Math.min(y + 24, 275));
    pdf.text(`For ${company.name || "RS Fabrication"}\n\nAuthorised Signatory`, right, 278, { align: "right" });
  }
  const safe = `${type.short} ${doc.no}`.replace(/[\\/:*?"<>|]+/g, "-");
  pdf.save(`${safe}.pdf`);
}

function LoginPanel({ initialized, onLogin, busy, error }: {
  initialized: boolean; onLogin: (username: string, password: string) => Promise<void>; busy: boolean; error: string;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return <main className="auth-shell">
    <form className="auth-card panel" onSubmit={event => { event.preventDefault(); void onLogin(username, password); }}>
      <div className="brand-mark">RS</div>
      <p className="eyebrow">RS FABRICATION</p>
      <h1>{initialized ? "Welcome back" : "Create your admin login"}</h1>
      <p className="muted">{initialized ? "Sign in to securely access your billing data." : "This private account protects all saved bills and business data."}</p>
      <label className="field"><span>Username</span><input required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
      <label className="field"><span>Password</span><input required minLength={12} type="password" autoComplete={initialized ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} /><small>Use at least 12 characters.</small></label>
      {error && <div className="notice error">{error}</div>}
      <button className="button primary full" disabled={busy}>{busy ? "Please wait…" : initialized ? "Log in" : "Create secure account"}</button>
      {!initialized && <p className="muted tiny">Only the first account can be created. Keep this password safe.</p>}
    </form>
  </main>;
}

export default function BillingApp() {
  const [ready, setReady] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel?: string; danger?: boolean; resolve: (yes: boolean) => void } | null>(null);
  const [tab, setTab] = useState<Tab>("dash");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [company, setCompany] = useState<Company>(DEFAULT_CO);
  const [parties, setParties] = useState<Record<string, Party>>({});
  const [items, setItems] = useState<Record<string, Item>>({});
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [draft, setDraft] = useState<Doc | null>(null);
  const [returnDocId, setReturnDocId] = useState<string | null>(null);
  const [partyDraft, setPartyDraft] = useState<Party | null>(null);
  const [formRecord, setFormRecord] = useState<Party | Item | null>(null);
  const [query, setQuery] = useState("");
  const [subTab, setSubTab] = useState<GSTSub>("r1");
  const [periodType, setPeriodType] = useState<GSTPeriodType>("month");
  const [periodKey, setPeriodKey] = useState("");
  const [paymentDraft, setPaymentDraft] = useState<{ docId: string; date: string; amount: string; mode: string; ref: string } | null>(null);
  const [paidNow, setPaidNow] = useState("");
  const lastBackup = company.lastBackupAt || "";

  const allDocs = useMemo(() => Object.values(docs), [docs]);
  const allParties = useMemo(() => Object.values(parties), [parties]);
  const allItems = useMemo(() => Object.values(items), [items]);
  const periodChoices = useMemo(() => periods()[periodType], [periodType]);
  const period = periodChoices.find(choice => choice.key === periodKey) || periodChoices[Math.min(1, periodChoices.length - 1)];
  const gstReport = useMemo(() => period ? gst3b(allDocs, company, period) : null, [allDocs, company, period]);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(current => current === text ? "" : current), 3500);
  }, []);
  const askConfirm = useCallback((title: string, message: string, options: { confirmLabel?: string; danger?: boolean } = {}) => new Promise<boolean>(resolve => {
    setConfirmDialog({ title, message, ...options, resolve });
  }), []);
  const applyData = useCallback((data: Database & { username?: string }) => {
    setCompany({ ...DEFAULT_CO, ...(data.company || {}) });
    setParties(data.parties || {});
    setItems(data.items || {});
    setDocs(data.docs || {});
    if (data.username) setUsername(data.username);
  }, []);
  const loadData = useCallback(async () => {
    const data = await request<Database & { username?: string }>("/api/data");
    applyData(data);
  }, [applyData]);

  useEffect(() => {
    void request<Database & { initialized: boolean; authenticated: boolean; username?: string }>("/api/auth")
      .then(session => {
        setInitialized(session.initialized); setAuthenticated(session.authenticated);
        if (session.authenticated) applyData(session);
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : "Could not connect to the server."))
      .finally(() => setReady(true));
  }, [applyData]);

  const login = async (user: string, password: string) => {
    setBusy(true); setAuthError("");
    try {
      const result = await request<{ username: string }>("/api/auth", { method: "POST", body: JSON.stringify({ action: initialized ? "login" : "setup", username: user, password }) });
      setUsername(result.username); setInitialized(true); setAuthenticated(true); await loadData();
    } catch (cause) { setAuthError(cause instanceof Error ? cause.message : "Login failed."); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    await request("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) });
    setAuthenticated(false); setDocs({}); setParties({}); setItems({}); setCompany(DEFAULT_CO); setTab("dash");
  };

  const saveRecord = async (kind: "company" | "parties" | "items" | "docs", id: string, value: unknown) => {
    await request("/api/data", { method: "POST", body: JSON.stringify({ kind, id, data: value }) });
    if (kind === "company") setCompany({ ...DEFAULT_CO, ...(value as Company) });
    if (kind === "parties") setParties(current => ({ ...current, [id]: value as Party }));
    if (kind === "items") setItems(current => ({ ...current, [id]: value as Item }));
    if (kind === "docs") setDocs(current => ({ ...current, [id]: value as Doc }));
  };
  const deleteRecord = async (kind: "parties" | "items" | "docs", id: string) => {
    await request(`/api/data?kind=${kind}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (kind === "parties") setParties(current => { const next = { ...current }; delete next[id]; return next; });
    if (kind === "items") setItems(current => { const next = { ...current }; delete next[id]; return next; });
    if (kind === "docs") setDocs(current => { const next = { ...current }; delete next[id]; return next; });
  };
  const runAction = async (action: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError("");
    try { await action(); if (success) showNotice(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The operation failed. Please try again."); }
    finally { setBusy(false); }
  };
  const startNew = (type: Doc["type"]) => {
    setTab(type === "INV" ? "inv" : type === "QTN" ? "qtn" : "pur");
    setOpenDoc(null); setReturnDocId(null); setPartyDraft(null); setDraft(newDoc(type, company, allDocs)); setPaidNow("");
  };
  const beginEdit = (doc: Doc) => { setReturnDocId(doc.id); setOpenDoc(null); setPartyDraft(null); setDraft(JSON.parse(JSON.stringify(doc)) as Doc); setPaidNow(""); };
  const saveDocument = async () => {
    if (!draft) return;
    const type = TYPES[draft.type];
    const no = draft.no.trim();
    if (!no) { setError(`Enter the ${type.noLabel.toLowerCase().replace(".", "")}.`); return; }
    if (!draft.party?.name.trim()) { setError(`Choose or add the ${type.partyRole}.`); return; }
    const lines = draft.lines.filter(line => line.name.trim());
    if (!lines.length) { setError("Add at least one item."); return; }
    if (lines.some(line => number(line.qty) <= 0)) { setError("Each item needs a quantity above zero."); return; }
    const duplicate = allDocs.find(doc => doc.type === draft.type && doc.id !== draft.id && doc.no === no && (draft.type !== "PUR" || doc.party?.name === draft.party?.name));
    if (duplicate && !await askConfirm("Duplicate number", `${type.noLabel} ${no} is already used. Save anyway?`, { confirmLabel: "Save anyway" })) return;
    setBusy(true); setError("");
    try {
      let party = draft.party;
      if (partyDraft?.name.trim()) {
        const savedParty: Party = { ...partyDraft, name: partyDraft.name.trim(), updated: Date.now() };
        await saveRecord("parties", savedParty.id, savedParty);
        party = { ...savedParty };
      }
      const preparedLines = lines.map(line => ({
        ...line, name: line.name.trim(), desc: String(line.desc || "").trim(), hsn: String(line.hsn || "").trim(),
        qty: number(line.qty), unit: String(line.unit || "").trim(), rate: number(line.rate), gst: number(line.gst),
      }));
      for (const line of preparedLines) {
        const exists = allItems.some(item => item.name.toLowerCase() === line.name.toLowerCase());
        if (!exists && line.saveItem !== false && draft.type !== "PUR") {
          const item: Item = { id: makeId("i"), name: line.name, desc: line.desc, hsn: line.hsn, unit: line.unit, rate: line.rate, gst: line.gst, updated: Date.now() };
          await saveRecord("items", item.id, item);
        }
      }
      const output: Doc = { ...draft, no, party, lines: preparedLines, updated: Date.now(), created: draft.created || Date.now() };
      if (paidNow && number(paidNow) > 0 && !draft.payments?.length) output.payments = [...(output.payments || []), { date: output.date, amount: round2(number(paidNow)), mode: "", ref: "" }];
      await saveRecord("docs", output.id, output);
      if (output.fromQtn && docs[output.fromQtn] && !docs[output.fromQtn].convertedTo) {
        await saveRecord("docs", output.fromQtn, { ...docs[output.fromQtn], convertedTo: output.id, updated: Date.now() });
      }
      setDraft(null); setReturnDocId(null); setOpenDoc(output.id); showNotice(`${type.short} ${output.no} saved.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this document."); }
    finally { setBusy(false); }
  };

  const downloadBackup = () => {
    const backup = { app: "rsf-billing", version: 1, exported: new Date().toISOString(), co: company, parties, items, docs };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `RS Fabrication backup ${today()}.json`; anchor.click(); URL.revokeObjectURL(url);
    void saveRecord("company", "company", { ...company, lastBackupAt: today() })
      .then(() => showNotice("Backup downloaded."))
      .catch(cause => setError(cause instanceof Error ? `Backup downloaded, but its date could not be saved: ${cause.message}` : "Backup downloaded, but its date could not be saved."));
  };
  const restoreBackup = async (file?: File) => {
    if (!file) return;
    try {
      const backup: unknown = JSON.parse(await file.text());
      if (!backup || typeof backup !== "object" || (backup as { app?: string }).app !== "rsf-billing") throw new Error("That file is not a backup from this billing app.");
      const count = Object.keys((backup as { docs?: object }).docs || {}).length;
      if (!await askConfirm("Restore backup?", `This backup has ${count} documents. Records with matching IDs will be replaced.`, { confirmLabel: "Restore backup", danger: true })) return;
      const result = await request<{ count: number }>("/api/data", { method: "POST", body: JSON.stringify({ action: "restore", backup }) });
      await loadData(); showNotice(`Backup restored (${result.count} records saved).`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not restore this backup."); }
  };
  const eraseData = async () => {
    if (!await askConfirm("Erase all business data?", "Invoices, quotations, purchases, contacts, items and settings will be permanently erased. Download a backup first.", { confirmLabel: "Erase all data", danger: true })) return;
    await runAction(async () => {
      const response = await request<{ ok: boolean }>("/api/data", { method: "POST", body: JSON.stringify({ action: "reset" }) });
      if (!response.ok) throw new Error("Could not erase saved business data.");
      setCompany(DEFAULT_CO); setParties({}); setItems({}); setDocs({});
    }, "All business records were erased.");
  };

  if (!ready) return <main className="auth-shell"><div className="loading-card" role="status" aria-label="Loading"><span className="loading-spinner" aria-hidden="true" /></div></main>;
  if (error && !authenticated && !authError) return <main className="auth-shell"><div className="panel auth-card"><h1>Cannot connect</h1><p className="notice error">{error}</p><p className="muted">Check MONGODB_URI and SESSION_SECRET in your deployment environment, then reload.</p><button className="button" onClick={() => window.location.reload()}>Try again</button></div></main>;
  if (!authenticated) return <LoginPanel initialized={initialized} onLogin={login} busy={busy} error={authError} />;

  const visibleDocs = tab === "inv" ? allDocs.filter(doc => doc.type === "INV") : tab === "qtn" ? allDocs.filter(doc => doc.type === "QTN") : tab === "pur" ? allDocs.filter(doc => doc.type === "PUR") : [];
  const selectedDoc = openDoc ? docs[openDoc] : undefined;
  const selectTab = (key: Tab) => { setTab(key); setMobileNavOpen(false); setOpenDoc(null); setDraft(null); setFormRecord(null); setQuery(""); setError(""); };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><button className="mobile-menu-toggle" aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(value => !value)}><span>{mobileNavOpen ? "×" : "☰"}</span></button><div className="brand-mark">RS</div><div><strong>{company.name || "RS Fabrication"}</strong><span>Billing · Quotations · Purchases</span></div></div>
      <div className="top-actions"><PwaInstallButton /><span className="signed-in">{username}</span><button className="button ghost small" onClick={() => void runAction(signOut)}>Log out</button></div>
    </header>
    <nav className="navigation">{NAV.map(([key, label, icon]) => <button className={tab === key ? "nav-item active" : "nav-item"} key={key} onClick={() => selectTab(key)}><span>{icon}</span>{label}</button>)}</nav>
    {mobileNavOpen && <div className="mobile-drawer-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setMobileNavOpen(false); }}><aside className="mobile-drawer" aria-label="Main navigation"><div className="drawer-heading"><div className="brand-mark">RS</div><div><strong>{company.name || "RS Fabrication"}</strong><span>Billing workspace</span></div><button aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}>×</button></div><nav>{NAV.map(([key, label, icon]) => <button className={tab === key ? "drawer-item active" : "drawer-item"} key={key} onClick={() => selectTab(key)}><span>{icon}</span>{label}{tab === key && <i>●</i>}</button>)}</nav><div className="drawer-account">Signed in as <strong>{username}</strong></div></aside></div>}
    <main className="content">
      {error && <div className="notice error" role="alert"><span>{error}</span><button aria-label="Dismiss" onClick={() => setError("")}>×</button></div>}
      {notice && <div className="notice success">{notice}</div>}
      {draft ? <DocumentEditor
        draft={draft} setDraft={setDraft} company={company} parties={allParties} items={allItems} partyDraft={partyDraft}
        setPartyDraft={setPartyDraft} paidNow={paidNow} setPaidNow={setPaidNow} busy={busy}
        onCancel={() => { setDraft(null); setPartyDraft(null); setOpenDoc(returnDocId); setReturnDocId(null); }} onSave={() => void saveDocument()}
      /> : formRecord ? <RecordEditor
        initial={formRecord} onCancel={() => setFormRecord(null)}
        onSave={async value => {
          const kind = "role" in value ? "parties" : "items";
          await saveRecord(kind, value.id, value as Party & Item);
          setFormRecord(null); showNotice("Saved successfully.");
        }}
        onDelete={async value => {
          const kind = "role" in value ? "parties" : "items";
          await deleteRecord(kind, value.id); setFormRecord(null); showNotice("Deleted.");
        }}
      /> : selectedDoc ? <DocumentView
        doc={selectedDoc} company={company} onBack={() => setOpenDoc(null)} onEdit={() => beginEdit(selectedDoc)}
        onDelete={() => void askConfirm("Delete document?", `Delete ${TYPES[selectedDoc.type].short.toLowerCase()} ${selectedDoc.no}? This cannot be undone.`, { confirmLabel: "Delete", danger: true }).then(yes => { if (yes) void runAction(async () => { await deleteRecord("docs", selectedDoc.id); setOpenDoc(null); }, "Document deleted."); })}
        onDuplicate={() => {
          const duplicate: Doc = {
            ...selectedDoc, id: makeId("d"),
            no: selectedDoc.type === "PUR" ? "" : nextNumber(selectedDoc.type, company, allDocs),
            date: today(), due: selectedDoc.type === "INV" ? addDays(today(), company.dueDays) : selectedDoc.type === "QTN" ? addDays(today(), company.qtnValidDays) : "",
            payments: [], cancelled: false, created: undefined, updated: undefined,
          };
          delete duplicate.convertedTo; delete duplicate.fromQtn;
          setReturnDocId(null); setDraft(duplicate); setOpenDoc(null);
        }}
        onToggleCancelled={() => void runAction(async () => { await saveRecord("docs", selectedDoc.id, { ...selectedDoc, cancelled: !selectedDoc.cancelled, updated: Date.now() }); }, selectedDoc.cancelled ? "Invoice restored." : "Invoice cancelled.")}
        onConvert={() => {
          const date = today();
          const converted: Doc = {
            ...selectedDoc, id: makeId("d"), type: "INV", no: nextNumber("INV", company, allDocs),
            date, due: addDays(date, company.dueDays), terms: company.terms, payments: [],
            fromQtn: selectedDoc.id, shipSame: selectedDoc.shipSame !== false, cancelled: false, created: undefined, updated: undefined,
          };
          setTab("inv"); setReturnDocId(selectedDoc.id); setDraft(converted); setPartyDraft(null);
        }}
        onPayment={() => setPaymentDraft({ docId: selectedDoc.id, date: today(), amount: String(calc(selectedDoc).balance), mode: "Bank transfer", ref: "" })}
        askConfirm={askConfirm}
        onRemovePayment={index => void runAction(async () => {
          const payments = [...(selectedDoc.payments || [])]; payments.splice(index, 1);
          await saveRecord("docs", selectedDoc.id, { ...selectedDoc, payments, updated: Date.now() });
        }, "Payment entry removed.")}
      /> : paymentDraft ? <PaymentEditor
        draft={paymentDraft} setDraft={setPaymentDraft}
        onCancel={() => setPaymentDraft(null)}
        onSave={() => void runAction(async () => {
          const original = docs[paymentDraft.docId]; if (!original) throw new Error("Document not found.");
          if (number(paymentDraft.amount) <= 0) throw new Error("Enter an amount above zero.");
          const updated: Doc = { ...original, payments: [...(original.payments || []), { date: paymentDraft.date || today(), amount: round2(number(paymentDraft.amount)), mode: paymentDraft.mode, ref: paymentDraft.ref.trim() }], updated: Date.now() };
          await saveRecord("docs", updated.id, updated); setPaymentDraft(null);
        }, "Payment saved.")}
      /> : tab === "dash" ? <Dashboard docs={allDocs} company={company} onNew={startNew} onOpen={setOpenDoc} lastBackup={lastBackup} onBackup={downloadBackup} /> :
        ["inv", "qtn", "pur"].includes(tab) ? <DocumentList tab={tab as "inv" | "qtn" | "pur"} docs={visibleDocs} query={query} setQuery={setQuery} onNew={() => startNew(tab === "inv" ? "INV" : tab === "qtn" ? "QTN" : "PUR")} onOpen={setOpenDoc} /> :
        tab === "parties" ? <PartyList parties={allParties} docs={allDocs} query={query} setQuery={setQuery} onAdd={() => setFormRecord({ id: makeId("p"), role: "customer", name: "", address: "", gstin: "", pan: "", phone: "", email: "", state: "" })} onOpen={id => { if (parties[id]) setFormRecord({ ...parties[id] }); }} /> :
        tab === "items" ? <ItemList items={allItems} query={query} setQuery={setQuery} onAdd={() => setFormRecord({ id: makeId("i"), name: "", desc: "", hsn: "", unit: "PCS", rate: 0, gst: 18 })} onOpen={id => { if (items[id]) setFormRecord({ ...items[id] }); }} /> :
        tab === "gst" && gstReport && period ? <GSTPage company={company} report={gstReport} period={period} periodType={periodType} setPeriodType={value => { setPeriodType(value); setPeriodKey(""); }} setPeriodKey={setPeriodKey} subTab={subTab} setSubTab={setSubTab} /> :
        <SettingsPage
          company={company} username={username} lastBackup={lastBackup} documentCount={allDocs.length} partyCount={allParties.length} itemCount={allItems.length}
          onSave={value => void runAction(async () => { await saveRecord("company", "company", { ...value, updated: Date.now() }); }, "Settings saved.")}
          onBackup={downloadBackup} onRestore={file => void restoreBackup(file)} onErase={() => void eraseData()}
        />}
    </main>
    {notice && <div className="toast success" role="status" aria-live="polite"><span className="toast-check">✓</span>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
    {confirmDialog && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { confirmDialog.resolve(false); setConfirmDialog(null); } }}><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message"><span className="confirm-icon">{confirmDialog.danger ? "!" : "?"}</span><h2 id="confirm-title">{confirmDialog.title}</h2><p id="confirm-message">{confirmDialog.message}</p><div className="confirm-actions"><button className="button" onClick={() => { confirmDialog.resolve(false); setConfirmDialog(null); }}>Cancel</button><button className={`button ${confirmDialog.danger ? "danger" : "primary"}`} onClick={() => { confirmDialog.resolve(true); setConfirmDialog(null); }}>{confirmDialog.confirmLabel || "Continue"}</button></div></section></div>}
  </div>;
}

function PageHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">RS FABRICATION · BILLING WORKSPACE</p><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>{action}</div>;
}

function Dashboard({ docs, company, onNew, onOpen, lastBackup, onBackup }: {
  docs: Doc[]; company: Company; onNew: (type: Doc["type"]) => void; onOpen: (id: string) => void; lastBackup: string; onBackup: () => void;
}) {
  const now = new Date(), fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = `${fy}-04-01`, fyEnd = `${fy + 1}-03-31`, monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("en-CA");
  const sales = docs.filter(doc => doc.type === "INV" && !doc.cancelled && doc.date >= fyStart && doc.date <= fyEnd).reduce((sum, doc) => sum + calc(doc).total, 0);
  const monthly = docs.filter(doc => doc.type === "INV" && !doc.cancelled && doc.date >= monthStart).reduce((sum, doc) => sum + calc(doc).total, 0);
  const receive = docs.filter(doc => doc.type === "INV" && !doc.cancelled).reduce((sum, doc) => sum + Math.max(0, calc(doc).balance), 0);
  const purchase = docs.filter(doc => doc.type === "PUR" && !doc.cancelled && doc.date >= fyStart && doc.date <= fyEnd).reduce((sum, doc) => sum + calc(doc).total, 0);
  const pay = docs.filter(doc => doc.type === "PUR" && !doc.cancelled).reduce((sum, doc) => sum + Math.max(0, calc(doc).balance), 0);
  const openQuotes = docs.filter(doc => doc.type === "QTN" && !doc.convertedTo).length;
  const month = periods().month[1] || periods().month[0];
  const taxDue = month ? gst3b(docs, company, month).cash : { i: 0, c: 0, s: 0 };
  const recent = [...docs].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 8);
  const backupDue = docs.length > 0 && (!lastBackup || lastBackup < addDays(today(), -7));
  return <div className="page-stack">
    <PageHeading title="Dashboard" subtitle={`Your business at a glance · ${displayDate(today())}`} />
    {backupDue && <div className="notice warning"><span>{lastBackup ? `Last backup: ${displayDate(lastBackup)}. Download a fresh copy to keep your records safe.` : "You have not downloaded a backup yet. Keep a safe copy of your records."}</span><button className="button small" onClick={onBackup}>Download backup</button></div>}
    <section className="quick-actions">
      <button onClick={() => onNew("INV")}><span className="quick-icon red">＋</span><span><strong>New invoice</strong><small>{nextNumber("INV", company, docs)}</small></span><b>→</b></button>
      <button onClick={() => onNew("QTN")}><span className="quick-icon gold">⌁</span><span><strong>New quotation</strong><small>Send an estimate to a customer</small></span><b>→</b></button>
      <button onClick={() => onNew("PUR")}><span className="quick-icon blue">⇩</span><span><strong>Record purchase</strong><small>Enter a supplier bill</small></span><b>→</b></button>
    </section>
    <section className="metric-grid">
      <Metric label="Sales this financial year" value={money(sales)} note={`This month · ${money(monthly)}`} icon="↗" />
      <Metric label="To receive" value={money(receive)} note={`${docs.filter(doc => doc.type === "INV" && calc(doc).balance > 0).length} unpaid invoice(s)`} icon="₹" />
      <Metric label="Purchases this FY" value={money(purchase)} note={`To pay · ${money(pay)}`} icon="↙" />
      <Metric label="GST cash to pay" value={money(taxDue.i + taxDue.c + taxDue.s)} note={`${month?.label || "Current period"} · estimate`} icon="%" />
      <Metric label="Open quotations" value={String(openQuotes)} note="Not yet converted to invoice" icon="◷" />
    </section>
    <section className="panel">
      <div className="section-heading"><div><h2>Recent documents</h2><p className="muted">Latest invoices, quotations and purchases</p></div></div>
      <DocumentTable docs={recent} onOpen={onOpen} empty="No bills yet. Create your first invoice or quotation above." />
    </section>
  </div>;
}

function Metric({ label, value, note, icon }: { label: string; value: string; note: string; icon: string }) {
  return <article className="metric panel"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{note}</small></article>;
}

function DocumentTable({ docs, onOpen, empty }: { docs: Doc[]; onOpen: (id: string) => void; empty: string }) {
  if (!docs.length) return <div className="empty-state"><span>▧</span><strong>Nothing here yet</strong><p>{empty}</p></div>;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>Document</th><th>Number</th><th>Date</th><th>Customer / supplier</th><th className="align-right">Amount</th><th>Status</th><th /></tr></thead>
    <tbody>{docs.map(doc => {
      const [status, tone] = documentStatus(doc);
      return <tr key={doc.id} className="clickable" onClick={() => onOpen(doc.id)}>
        <td><span className={`type-mark type-${doc.type.toLowerCase()}`}>{doc.type === "INV" ? "INV" : doc.type === "QTN" ? "QTN" : "PUR"}</span></td>
        <td className="number">{doc.no || "—"}</td><td>{displayDate(doc.date)}</td><td>{doc.party?.name || "—"}</td>
        <td className="align-right number">{format(calc(doc).total)}{doc.type !== "QTN" && calc(doc).received > 0 && calc(doc).balance > 0 && <small className="balance-note">Balance {format(calc(doc).balance)}</small>}</td>
        <td><span className={`status ${tone}`}>{status}</span></td><td className="arrow">↗</td>
      </tr>;
    })}</tbody></table></div>;
}

function DocumentList({ tab, docs, query, setQuery, onNew, onOpen }: {
  tab: "inv" | "qtn" | "pur"; docs: Doc[]; query: string; setQuery: (value: string) => void; onNew: () => void; onOpen: (id: string) => void;
}) {
  const type = tab === "inv" ? "INV" : tab === "qtn" ? "QTN" : "PUR";
  const filtered = docs.filter(doc => !query || [doc.no, doc.party?.name, ...doc.lines.map(line => line.name)].join(" ").toLowerCase().includes(query.toLowerCase()));
  const total = filtered.filter(doc => !doc.cancelled).reduce((sum, doc) => sum + calc(doc).total, 0);
  const balance = filtered.filter(doc => !doc.cancelled && doc.type !== "QTN").reduce((sum, doc) => sum + calc(doc).balance, 0);
  const title = TYPES[type].plural;
  return <div className="page-stack">
    <PageHeading title={title} subtitle={`${filtered.length} record(s) · Total ${money(total)}${type !== "QTN" ? ` · Outstanding ${money(balance)}` : ""}`} action={<button className="button primary" onClick={onNew}>＋ New {TYPES[type].short.toLowerCase()}</button>} />
    <div className="filter-bar"><label className="search-box"><span>⌕</span><input placeholder="Search by number, party or item" value={query} onChange={event => setQuery(event.target.value)} /></label><span className="muted">{filtered.length} shown</span></div>
    <section className="panel"><DocumentTable docs={filtered} onOpen={onOpen} empty={`No ${title.toLowerCase()} ${query ? "match this search." : "yet. Create one to get started."}`} /></section>
  </div>;
}

function DocumentView({ doc, company, onBack, onEdit, onDelete, onDuplicate, onToggleCancelled, onConvert, onPayment, onRemovePayment, askConfirm }: {
  doc: Doc; company: Company; onBack: () => void; onEdit: () => void; onDelete: () => void; onDuplicate: () => void;
  onToggleCancelled: () => void; onConvert: () => void; onPayment: () => void; onRemovePayment: (index: number) => void; askConfirm: (title: string, message: string, options?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}) {
  const totals = calc(doc), type = TYPES[doc.type], [status, tone] = documentStatus(doc);
  return <div className="page-stack">
    <button className="back-link" onClick={onBack}>← Back to {type.plural}</button>
    <div className="page-heading doc-heading"><div><p className="eyebrow">{type.label}</p><h1>{doc.no || "Untitled document"}</h1><div className="row-wrap"><span className={`status ${tone}`}>{status}</span><span className="muted">{doc.party?.name} · {money(totals.total)}</span>{doc.convertedTo && <span className="muted">Converted to invoice {doc.convertedTo}</span>}{doc.fromQtn && <span className="muted">From quotation {doc.fromQtn}</span>}</div></div>
      <div className="action-wrap"><button className="button primary" onClick={() => downloadPdf(doc, company)}>Download PDF</button><button className="button" onClick={() => window.print()}>Print</button><button className="button" onClick={onEdit}>Edit</button>
        {doc.type === "INV" && <button className="button" onClick={onToggleCancelled}>{doc.cancelled ? "Restore invoice" : "Cancel invoice"}</button>}
        {doc.type !== "QTN" && !doc.cancelled && totals.balance > 0 && <button className="button" onClick={onPayment}>{doc.type === "PUR" ? "Record payment made" : "Record payment received"}</button>}
        {doc.type === "QTN" && !doc.convertedTo && <button className="button" onClick={onConvert}>Convert to invoice</button>}
        <button className="button" onClick={onDuplicate}>Duplicate</button>
        <button className="button danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
    {(doc.payments || []).length > 0 && <section className="panel"><div className="section-heading"><div><h2>Payments</h2><p className="muted">Received / paid against this document</p></div></div>
      <div className="payment-list">{doc.payments?.map((payment, index) => <div className="payment-row" key={`${payment.date}-${index}`}><span>{displayDate(payment.date)} · {payment.mode || "Payment"}{payment.ref ? ` · ${payment.ref}` : ""}</span><strong>{money(payment.amount)}</strong><button className="text-button" onClick={() => void askConfirm("Remove payment?", "This payment entry will be removed from the document.", { confirmLabel: "Remove", danger: true }).then(yes => { if (yes) onRemovePayment(index); })}>Remove</button></div>)}</div>
    </section>}
    <InvoicePaper doc={doc} company={company} />
  </div>;
}

function InvoicePaper({ doc, company }: { doc: Doc; company: Company }) {
  const totals = calc(doc), type = TYPES[doc.type], purchase = doc.type === "PUR";
  const rateRows = Object.entries(totals.byRate).filter(([rate]) => Number(rate) > 0);
  return <article className="invoice-paper">
    <div className="invoice-type">{doc.type === "INV" ? "TAX INVOICE" : doc.type === "QTN" ? "QUOTATION" : "PURCHASE BILL"}{doc.cancelled && <b className="cancelled-label">CANCELLED</b>}<span>{doc.type === "INV" ? "ORIGINAL FOR RECIPIENT" : doc.type === "QTN" ? "ESTIMATE" : "PURCHASE RECORD"}</span></div>
    <div className="invoice-company">{!purchase && <div className="invoice-logo">RS</div>}<div><h2>{purchase ? doc.party?.name : company.name || "RS Fabrication"}</h2><p>{purchase ? doc.party?.address : company.address}</p><p>{purchase ? doc.party?.gstin && `GSTIN: ${doc.party.gstin}` : [company.mobile && `Mobile: ${company.mobile}`, company.gstin && `GSTIN: ${company.gstin}`, company.pan && `PAN: ${company.pan}`, company.email].filter(Boolean).join(" · ")}</p></div></div>
    <div className="invoice-red-line" />
    <div className="invoice-meta"><span><b>{type.noLabel}</b> {doc.no}</span><span><b>{type.dateLabel.replace("Quotation ", "")}</b> {displayDate(doc.date)}</span>{doc.due && <span><b>{type.due}</b> {displayDate(doc.due)}</span>}</div>
    <div className="invoice-parties">
      <div><strong>{purchase ? "BILLED TO (US)" : type.partyLabel.toUpperCase()}</strong><b>{purchase ? company.name : doc.party?.name}</b><p>{purchase ? company.address : doc.party?.address}</p><p>{purchase ? company.gstin && `GSTIN: ${company.gstin}` : [doc.party?.gstin && `GSTIN: ${doc.party.gstin}`, doc.party?.pan && `PAN: ${doc.party.pan}`, doc.pos && `Place of Supply: ${doc.pos}`].filter(Boolean).join(" · ")}</p></div>
      {purchase ? doc.ref ? <div><strong>OUR ENTRY REF.</strong><p>{doc.ref}</p></div> : <div /> : (doc.type === "INV" || doc.shipSame === false) && <div><strong>SHIP TO</strong><b>{doc.shipSame === false ? doc.shipName : doc.party?.name}</b><p>{doc.shipSame === false ? doc.shipAddress : doc.party?.address}</p></div>}
    </div>
    <div className="table-scroll"><table className="data-table invoice-table"><thead><tr><th>Items / work</th>{totals.lines.some(line => line.hsn) && <th>HSN/SAC</th>}<th>Qty.</th><th className="align-right">Rate</th><th className="align-right">Tax</th><th className="align-right">Amount</th></tr></thead>
      <tbody>{totals.lines.map((line, index) => <tr key={`${line.name}-${index}`}><td><b>{line.name}</b>{line.desc && <small className="line-description">{line.desc}</small>}</td>{totals.lines.some(row => row.hsn) && <td>{line.hsn}</td>}<td>{format(line.qty)} {line.unit}</td><td className="align-right">{format(line.rate)}</td><td className="align-right">{format(line.tax)}<small className="line-description">({format(line.gst)}%)</small></td><td className="align-right">{format(line.total)}</td></tr>)}
        <tr className="subtotal-row"><td>SUBTOTAL</td>{totals.lines.some(row => row.hsn) && <td /> }<td>{format(totals.qty)}</td><td /><td className="align-right">₹ {format(totals.tax)}</td><td className="align-right">₹ {format(totals.gross)}</td></tr>
      </tbody></table></div>
    <div className="invoice-lower">
      {!purchase && <div className="bank-details"><strong>BANK DETAILS</strong><p>{company.bankName}</p><p>Account No.: {company.account}</p><p>IFSC: {company.ifsc}</p><p>{company.bank}</p></div>}
      <div className="invoice-totals"><div><span>Taxable amount</span><b>{money(totals.taxable)}</b></div>{rateRows.flatMap(([rate, tax]) => doc.igst
        ? [<div key={`${rate}-i`}><span>IGST @{format(rate)}%</span><b>{money(tax)}</b></div>]
        : [<div key={`${rate}-c`}><span>CGST @{format(number(rate) / 2)}%</span><b>{money(round2(tax / 2))}</b></div>, <div key={`${rate}-s`}><span>SGST @{format(number(rate) / 2)}%</span><b>{money(round2(tax - round2(tax / 2)))}</b></div>])}
        {totals.roundOff !== 0 && <div><span>Round off</span><b>{money(totals.roundOff)}</b></div>}<div className="grand-total"><span>Total amount</span><b>{money(totals.total)}</b></div>{doc.type !== "QTN" && <><div><span>{purchase ? "Paid" : "Received"}</span><b>{money(totals.received)}</b></div><div><span>Balance</span><b>{money(totals.balance)}</b></div></>}
      </div>
    </div>
    <div className="invoice-foot"><div>{(purchase ? doc.notes : doc.terms || doc.notes) && <><strong>{purchase ? "NOTES" : "TERMS AND CONDITIONS"}</strong><p>{purchase ? doc.notes : doc.terms}</p>{doc.notes && doc.terms && <p>Notes: {doc.notes}</p>}</>}</div><div><strong>Total amount (in words)</strong><p>{amountWords(totals.total)}</p>{!purchase && <p className="signature">For {company.name || "RS Fabrication"}<br /><br />Authorised Signatory</p>}</div></div>
  </article>;
}

function DocumentEditor({ draft, setDraft, company, parties, items, partyDraft, setPartyDraft, paidNow, setPaidNow, busy, onCancel, onSave }: {
  draft: Doc; setDraft: (doc: Doc) => void; company: Company; parties: Party[]; items: Item[];
  partyDraft: Party | null; setPartyDraft: (party: Party | null) => void; paidNow: string; setPaidNow: (value: string) => void;
  busy: boolean; onCancel: () => void; onSave: () => void;
}) {
  const type = TYPES[draft.type], totals = calc(draft);
  const update = <K extends keyof Doc>(key: K, value: Doc[K]) => setDraft({ ...draft, [key]: value });
  const compatible = parties.filter(party => party.role === type.partyRole || party.role === "both").sort((a, b) => a.name.localeCompare(b.name));
  const selectedId = partyDraft ? "__new" : draft.party?.id || "";
  const pickParty = (value: string) => {
    if (value === "__new") {
      const fresh: Party = { id: makeId("p"), role: type.partyRole, name: "", address: "", gstin: "", pan: "", phone: "", email: "", state: "" };
      setPartyDraft(fresh); update("party", fresh);
    } else if (value) {
      const person = parties.find(party => party.id === value);
      if (!person) return;
      setPartyDraft(null);
      const snapshot = { id: person.id, name: person.name, address: person.address, gstin: person.gstin, pan: person.pan, phone: person.phone };
      update("party", snapshot);
      const state = stateOfGstin(person.gstin);
      const stateName = state?.name || person.state;
      if (stateName && draft.type !== "PUR") setDraft({ ...draft, party: snapshot, pos: stateName, igst: stateName.toLowerCase() !== company.state.toLowerCase() });
      else update("party", snapshot);
    } else { setPartyDraft(null); update("party", null); }
  };
  const updateParty = (key: keyof Party, value: string) => {
    if (!partyDraft) return;
    let next = { ...partyDraft, [key]: value };
    if (key === "gstin") {
      next = { ...next, gstin: value.toUpperCase() };
      const state = stateOfGstin(value);
      if (state) { update("pos", state.name); update("igst", state.code !== company.stateCode); }
      if (value.length >= 12 && !partyDraft.pan) next.pan = value.slice(2, 12);
    }
    setPartyDraft(next); update("party", next);
  };
  const updateLine = (index: number, patch: Partial<Line>) => {
    const lines = draft.lines.map((line, row) => row === index ? { ...line, ...patch } : line);
    const updated = { ...draft, lines }; setDraft(updated);
  };
  const addLine = () => update("lines", [...draft.lines, EMPTY_LINE()]);
  const removeLine = (index: number) => update("lines", draft.lines.filter((_, row) => row !== index));
  const dateChange = (date: string) => {
    const due = draft.type === "INV" ? addDays(date, company.dueDays) : draft.type === "QTN" ? addDays(date, company.qtnValidDays) : "";
    setDraft({ ...draft, date, due: due || draft.due });
  };
  return <div className="page-stack editor-page">
    <button className="back-link" onClick={onCancel}>← Cancel</button>
    <PageHeading title={`${draft.created ? "Edit" : "New"} ${type.short.toLowerCase()}`} subtitle="Add document details and review the tax calculation before saving." />
    <section className="panel editor-section"><div className="section-heading"><div><h2>Document details</h2><p className="muted">Number, dates and supply information</p></div></div><div className="form-grid four">
      <Field label={type.noLabel}><input value={draft.no} placeholder={draft.type === "PUR" ? "As on supplier bill" : ""} onChange={event => update("no", event.target.value)} /></Field>
      <Field label={type.dateLabel}><input type="date" value={draft.date} onChange={event => dateChange(event.target.value)} /></Field>
      <Field label={type.due}><input type="date" value={draft.due || ""} onChange={event => update("due", event.target.value)} /></Field>
      {draft.type === "PUR" ? <Field label="Our reference (optional)"><input value={draft.ref || ""} onChange={event => update("ref", event.target.value)} /></Field> : <Field label="Place of supply"><input value={draft.pos || ""} onChange={event => update("pos", event.target.value)} /></Field>}
    </div></section>
    <section className="panel editor-section"><div className="section-heading"><div><h2>{type.partyLabel}</h2><p className="muted">Choose a saved {type.partyRole} or add one to this document.</p></div></div>
      <Field label={`Choose ${type.partyRole}`}><select value={selectedId} onChange={event => pickParty(event.target.value)}><option value="">Select {type.partyRole}…</option>{compatible.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}<option value="__new">＋ Add new {type.partyRole}</option></select></Field>
      {partyDraft && <div className="form-grid two subform">
        <Field label="Name"><input required value={partyDraft.name} onChange={event => updateParty("name", event.target.value)} /></Field>
        <Field label="Mobile"><input inputMode="tel" value={partyDraft.phone || ""} onChange={event => updateParty("phone", event.target.value)} /></Field>
        <Field label="Address" wide><textarea rows={2} value={partyDraft.address || ""} onChange={event => updateParty("address", event.target.value)} /></Field>
        <Field label="GSTIN"><input value={partyDraft.gstin || ""} onChange={event => updateParty("gstin", event.target.value.toUpperCase())} /></Field>
        <Field label="PAN"><input value={partyDraft.pan || ""} onChange={event => updateParty("pan", event.target.value.toUpperCase())} /></Field>
      </div>}
      {draft.party && !partyDraft && <p className="party-summary">{draft.party.address}{draft.party.gstin && ` · GSTIN ${draft.party.gstin}`}{draft.party.pan && ` · PAN ${draft.party.pan}`}</p>}
      {draft.type !== "PUR" ? <div className="option-list">
        <label className="check-row"><input type="checkbox" checked={!!draft.igst} onChange={event => update("igst", event.target.checked)} /><span>Out-of-state customer (charge IGST instead of CGST + SGST)</span></label>
        <label className="check-row"><input type="checkbox" checked={draft.shipSame !== false} onChange={event => update("shipSame", event.target.checked)} /><span>Ship to the same address</span></label>
        {draft.shipSame === false && <div className="form-grid two"><Field label="Ship to name"><input value={draft.shipName || ""} onChange={event => update("shipName", event.target.value)} /></Field><Field label="Ship to address"><textarea value={draft.shipAddress || ""} onChange={event => update("shipAddress", event.target.value)} /></Field></div>}
      </div> : <div className="option-list"><label className="check-row"><input type="checkbox" checked={!!draft.igst} onChange={event => update("igst", event.target.checked)} /><span>Supplier charged IGST (out-of-state)</span></label><label className="check-row"><input type="checkbox" checked={!!draft.rcm} onChange={event => update("rcm", event.target.checked)} /><span>Reverse charge applies (for example, GTA freight)</span></label></div>}
    </section>
    <section className="panel editor-section"><div className="section-heading"><div><h2>Items &amp; work</h2><p className="muted">Pick a saved item or enter new work details.</p></div><button className="button" onClick={addLine}>＋ Add item</button></div>
      <datalist id="saved-items">{items.map(item => <option key={item.id} value={item.name} />)}</datalist>
      <div className="line-list">{draft.lines.map((line, index) => <article className="line-card" key={index}>
        <div className="line-heading"><span className="line-index">{String(index + 1).padStart(2, "0")}</span><Field label="Item or work"><input list="saved-items" value={line.name} onChange={event => {
          const name = event.target.value, existing = items.find(item => item.name.toLowerCase() === name.trim().toLowerCase());
          updateLine(index, existing ? { name, desc: existing.desc || "", hsn: existing.hsn || "", unit: existing.unit || "PCS", rate: existing.rate || 0, gst: existing.gst ?? 18 } : { name });
        }} placeholder="e.g. MS rack door" /></Field><button className="button ghost" disabled={draft.lines.length <= 1} onClick={() => removeLine(index)}>Remove</button></div>
        <Field label="Size, material and finish"><textarea rows={2} value={line.desc || ""} onChange={event => updateLine(index, { desc: event.target.value })} /></Field>
        <div className="form-grid six">
          <Field label="HSN/SAC"><input value={line.hsn || ""} onChange={event => updateLine(index, { hsn: event.target.value })} /></Field>
          <Field label="Quantity"><input type="number" min="0" step="any" value={line.qty} onChange={event => updateLine(index, { qty: number(event.target.value) })} /></Field>
          <Field label="Unit"><input list="unit-options" value={line.unit || ""} onChange={event => updateLine(index, { unit: event.target.value })} /><datalist id="unit-options">{UNIT_OPTIONS.map(unit => <option key={unit} value={unit} />)}</datalist></Field>
          <Field label="Rate (₹)"><input type="number" min="0" step="any" value={line.rate} onChange={event => updateLine(index, { rate: number(event.target.value) })} /></Field>
          <Field label="GST %"><select value={number(line.gst)} onChange={event => updateLine(index, { gst: number(event.target.value) })}>{GST_RATES.map(rate => <option key={rate} value={rate}>{rate}%</option>)}</select></Field>
          <div className="amount-cell"><span>Taxable amount</span><b>{money(round2(number(line.qty) * number(line.rate)))}</b></div>
        </div>
        {draft.type !== "PUR" && line.name && !items.some(item => item.name.toLowerCase() === line.name.trim().toLowerCase()) && <label className="check-row save-item"><input type="checkbox" checked={line.saveItem !== false} onChange={event => updateLine(index, { saveItem: event.target.checked })} /><span>Save “{line.name}” to my item list</span></label>}
      </article>)}</div>
      <div className="totals-panel"><span>Taxable amount</span><b>{money(totals.taxable)}</b>{Object.entries(totals.byRate).filter(([rate]) => number(rate) > 0).flatMap(([rate, tax]) => draft.igst ? [<span key={`${rate}-label`}>IGST @{format(rate)}%</span>, <b key={`${rate}-tax`}>{money(tax)}</b>] : [<span key={`${rate}-cl`}>CGST @{format(number(rate) / 2)}%</span>, <b key={`${rate}-cv`}>{money(round2(tax / 2))}</b>, <span key={`${rate}-sl`}>SGST @{format(number(rate) / 2)}%</span>, <b key={`${rate}-sv`}>{money(round2(tax - round2(tax / 2)))}</b>])}
        {totals.roundOff !== 0 && <><span>Round off</span><b>{money(totals.roundOff)}</b></>}<strong>Total</strong><strong>{money(totals.total)}</strong><small>{amountWords(totals.total)}</small>
      </div>
    </section>
    <section className="panel editor-section"><div className="form-grid two">{draft.type !== "PUR" && <Field label="Terms and conditions"><textarea rows={6} value={draft.terms || ""} onChange={event => update("terms", event.target.value)} /></Field>}<Field label="Notes (optional)"><textarea rows={3} value={draft.notes || ""} onChange={event => update("notes", event.target.value)} /></Field>
      {!draft.created && draft.type !== "QTN" && <Field label={draft.type === "PUR" ? "Paid now (₹)" : "Received now (₹)"}><input type="number" min="0" step="any" value={paidNow} onChange={event => setPaidNow(event.target.value)} /></Field>}</div>
    </section>
    <div className="sticky-actions"><span className="muted">{draft.lines.length} item(s) · {money(totals.total)}</span><div><button className="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="button primary" onClick={onSave} disabled={busy}>{busy ? <><span className="button-spinner" />Saving…</> : `Save ${type.short.toLowerCase()}`}</button></div></div>
  </div>;
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`field${wide ? " span-two" : ""}`}><span>{label}</span>{children}</label>;
}

function PaymentEditor({ draft, setDraft, onCancel, onSave }: {
  draft: { docId: string; date: string; amount: string; mode: string; ref: string };
  setDraft: (draft: { docId: string; date: string; amount: string; mode: string; ref: string }) => void;
  onCancel: () => void; onSave: () => void;
}) {
  const change = (key: "date" | "amount" | "mode" | "ref", value: string) => setDraft({ ...draft, [key]: value });
  return <div className="page-stack narrow"><button className="back-link" onClick={onCancel}>← Back to document</button><PageHeading title="Record payment" subtitle="Add payment details to update the outstanding balance." />
    <section className="panel editor-section"><div className="form-grid two"><Field label="Date"><input type="date" value={draft.date} onChange={event => change("date", event.target.value)} /></Field><Field label="Amount (₹)"><input type="number" min="0.01" step="any" value={draft.amount} onChange={event => change("amount", event.target.value)} /></Field><Field label="Mode"><select value={draft.mode} onChange={event => change("mode", event.target.value)}>{["Bank transfer","UPI","Cheque","Cash","NEFT/RTGS"].map(mode => <option key={mode}>{mode}</option>)}</select></Field><Field label="Reference"><input placeholder="UTR / cheque number" value={draft.ref} onChange={event => change("ref", event.target.value)} /></Field></div><div className="form-actions"><button className="button" onClick={onCancel}>Cancel</button><button className="button primary" onClick={onSave}>Save payment</button></div></section>
  </div>;
}

function PartyList({ parties, docs, query, setQuery, onAdd, onOpen }: {
  parties: Party[]; docs: Doc[]; query: string; setQuery: (value: string) => void; onAdd: () => void; onOpen: (id: string) => void;
}) {
  const visible = parties.filter(person => !query || `${person.name} ${person.gstin || ""} ${person.phone || ""}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return <div className="page-stack"><PageHeading title="Customers & suppliers" subtitle={`${parties.length} saved contacts. Use them when making invoices and purchase bills.`} action={<button className="button primary" onClick={onAdd}>＋ Add contact</button>} />
    <div className="filter-bar"><label className="search-box"><span>⌕</span><input placeholder="Search name, GSTIN or mobile" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    <section className="panel"><div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Type</th><th>GSTIN</th><th>Mobile</th><th className="align-right">Billed total</th></tr></thead><tbody>
      {visible.map(person => {
        const billed = docs.filter(doc => doc.party?.id === person.id && doc.type !== "QTN").reduce((sum, doc) => sum + calc(doc).total, 0);
        return <tr className="clickable" key={person.id} onClick={() => onOpen(person.id)}><td><b>{person.name}</b><small className="line-description">{person.address}</small></td><td>{person.role === "both" ? "Both" : person.role === "supplier" ? "Supplier" : "Customer"}</td><td className="number">{person.gstin}</td><td>{person.phone}</td><td className="align-right number">{money(billed)}</td></tr>;
      })}
      {!visible.length && <tr><td colSpan={5}><div className="empty-state"><strong>{query ? "No matches" : "No contacts yet"}</strong><p>Add a contact here, or while creating a bill.</p></div></td></tr>}
    </tbody></table></div></section>
  </div>;
}

function ItemList({ items, query, setQuery, onAdd, onOpen }: {
  items: Item[]; query: string; setQuery: (value: string) => void; onAdd: () => void; onOpen: (id: string) => void;
}) {
  const visible = items.filter(item => !query || `${item.name} ${item.desc || ""}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return <div className="page-stack"><PageHeading title="Items & work" subtitle="Saved items fill in their description, rate and GST when selected on a bill." action={<button className="button primary" onClick={onAdd}>＋ Add item</button>} />
    <div className="filter-bar"><label className="search-box"><span>⌕</span><input placeholder="Search items" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    <section className="panel"><div className="table-scroll"><table className="data-table"><thead><tr><th>Item / work</th><th>HSN/SAC</th><th>Unit</th><th className="align-right">Rate</th><th className="align-right">GST</th></tr></thead><tbody>
      {visible.map(item => <tr className="clickable" key={item.id} onClick={() => onOpen(item.id)}><td><b>{item.name}</b><small className="line-description">{item.desc}</small></td><td className="number">{item.hsn}</td><td>{item.unit}</td><td className="align-right number">{money(item.rate)}</td><td className="align-right">{format(item.gst)}%</td></tr>)}
      {!visible.length && <tr><td colSpan={5}><div className="empty-state"><strong>{query ? "No matches" : "No items yet"}</strong><p>Add common work here: rack doors, gates, sheds, grills.</p></div></td></tr>}
    </tbody></table></div></section>
  </div>;
}

function RecordEditor({ initial, onCancel, onSave, onDelete }: {
  initial: Party | Item; onCancel: () => void; onSave: (record: Party | Item) => Promise<void>; onDelete: (record: Party | Item) => Promise<void>;
}) {
  const [record, setRecord] = useState<Party | Item>({ ...initial });
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const isParty = "role" in record;
  const change = (key: string, value: string | number) => setRecord(current => ({ ...current, [key]: value }));
  const submit = async () => {
    if (!record.name.trim()) return;
    setBusy(true); setFormError("");
    try {
      const value = { ...record, name: record.name.trim(), updated: Date.now() } as Party | Item;
      if ("role" in value) { value.gstin = (value.gstin || "").toUpperCase(); value.pan = (value.pan || "").toUpperCase(); }
      await onSave(value);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Could not save this record."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setConfirmOpen(false);
    setFormError("");
    setBusy(true);
    try { await onDelete(record); }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : "Could not delete this record."); }
    finally { setBusy(false); }
  };
  return <div className="page-stack narrow"><button className="back-link" onClick={onCancel}>← Back</button><PageHeading title={`${isParty ? "Contact" : "Item"} details`} subtitle="Keep saved details up to date for future bills." />
    <section className="panel editor-section"><div className="form-grid two">
      <Field label={isParty ? "Name" : "Item name"} wide><input autoFocus value={record.name} onChange={event => change("name", event.target.value)} /></Field>
      {isParty ? <>
        <Field label="Type"><select value={(record as Party).role} onChange={event => change("role", event.target.value)}>{[["customer","Customer"],["supplier","Supplier"],["both","Both"]].map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></Field>
        <Field label="Mobile"><input inputMode="tel" value={(record as Party).phone || ""} onChange={event => change("phone", event.target.value)} /></Field>
        <Field label="Address" wide><textarea rows={3} value={(record as Party).address || ""} onChange={event => change("address", event.target.value)} /></Field>
        <Field label="GSTIN"><input value={(record as Party).gstin || ""} onChange={event => {
          const gstin = event.target.value.toUpperCase();
          setRecord(current => "role" in current ? { ...current, gstin, state: stateOfGstin(gstin)?.name || current.state, pan: !current.pan && gstin.length >= 12 ? gstin.slice(2, 12) : current.pan } : current);
        }} /></Field>
        <Field label="PAN"><input value={(record as Party).pan || ""} onChange={event => change("pan", event.target.value.toUpperCase())} /></Field>
        <Field label="State"><input value={(record as Party).state || ""} onChange={event => change("state", event.target.value)} /></Field>
        <Field label="Email"><input type="email" value={(record as Party).email || ""} onChange={event => change("email", event.target.value)} /></Field>
      </> : <>
        <Field label="Description (one detail per line)" wide><textarea rows={3} value={(record as Item).desc || ""} onChange={event => change("desc", event.target.value)} /></Field>
        <Field label="HSN/SAC"><input value={(record as Item).hsn || ""} onChange={event => change("hsn", event.target.value)} /></Field>
        <Field label="Unit"><input value={(record as Item).unit || ""} onChange={event => change("unit", event.target.value)} /></Field>
        <Field label="Rate (₹)"><input type="number" min="0" step="any" value={(record as Item).rate} onChange={event => change("rate", number(event.target.value))} /></Field>
        <Field label="GST %"><select value={(record as Item).gst} onChange={event => change("gst", number(event.target.value))}>{GST_RATES.map(rate => <option key={rate}>{rate}</option>)}</select></Field>
      </>}
    </div>{formError && <div className="notice error">{formError}</div>}<div className="form-actions"><button className="button danger" disabled={busy} onClick={() => setConfirmOpen(true)}>{busy ? <><span className="button-spinner" />Deleting…</> : "Delete"}</button><span className="grow" /><button className="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="button primary" disabled={busy || !record.name.trim()} onClick={() => void submit()}>{busy ? <><span className="button-spinner" />Saving…</> : "Save"}</button></div></section>
    {confirmOpen && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setConfirmOpen(false); }}><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="record-delete-title"><span className="confirm-icon">!</span><h2 id="record-delete-title">Delete {isParty ? "contact" : "item"}?</h2><p>Delete {record.name}? Existing bills keep their saved copy.</p><div className="confirm-actions"><button className="button" onClick={() => setConfirmOpen(false)}>Cancel</button><button className="button danger" onClick={() => void remove()}>Delete</button></div></section></div>}
  </div>;
}

function SettingsPage({ company, username, lastBackup, documentCount, partyCount, itemCount, onSave, onBackup, onRestore, onErase }: {
  company: Company; username: string; lastBackup: string; documentCount: number; partyCount: number; itemCount: number; onSave: (company: Company) => void; onBackup: () => void; onRestore: (file?: File) => void; onErase: () => void;
}) {
  const year = todayFy();
  const [draft, setDraft] = useState<Company>({ ...company });
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const change = (key: keyof Company, value: string | number) => setDraft(current => ({ ...current, [key]: value }));
  const changePassword = async () => {
    setPasswordMessage("");
    try {
      await request("/api/auth", { method: "POST", body: JSON.stringify({ action: "change-password", username, currentPassword: oldPassword, password: newPassword }) });
      setPasswordMessage("Password changed. Please log in again."); setOldPassword(""); setNewPassword("");
      window.setTimeout(() => window.location.reload(), 1500);
    } catch (cause) { setPasswordMessage(cause instanceof Error ? cause.message : "Could not change password."); }
  };
  const fields: Array<[keyof Company, string]> = [
    ["name","Business name"],["address","Address"],["mobile","Mobile"],["email","Email"],["gstin","GSTIN"],["pan","PAN"],["state","State"],["stateCode","State code"],["udyam","Udyam registration no."],
  ];
  return <div className="page-stack">
    <PageHeading title="Settings" subtitle="Business profile, invoice defaults, account security and data protection." />
    <section className="panel editor-section"><div className="section-heading"><div><h2>Business details</h2><p className="muted">These details appear on invoices and quotations.</p></div></div><div className="form-grid two">
      {fields.map(([key, label]) => <Field label={label} wide={key === "address"} key={key}>{key === "address" ? <textarea rows={3} value={draft[key]} onChange={event => change(key, event.target.value)} /> : <input value={draft[key]} onChange={event => change(key, event.target.value)} />}</Field>)}
    </div></section>
    <section className="panel editor-section"><div className="section-heading"><div><h2>Bank details</h2><p className="muted">Printed on invoices to help customers make payments.</p></div></div><div className="form-grid two">
      {([["bankName","Account name"],["ifsc","IFSC code"],["account","Account number"],["bank","Bank and branch"]] as Array<[keyof Company,string]>).map(([key,label]) => <Field key={key} label={label}><input value={draft[key]} onChange={event => change(key, event.target.value)} /></Field>)}
    </div></section>
    <section className="panel editor-section"><div className="section-heading"><div><h2>Numbering &amp; defaults</h2><p className="muted">Number prefixes and document due dates.</p></div></div><div className="form-grid two">
      {([["invPrefix","Invoice number prefix"],["qtnPrefix","Quotation number prefix"]] as Array<[keyof Company,string]>).map(([key,label]) => <Field key={key} label={label}><input value={draft[key]} onChange={event => change(key, event.target.value)} /></Field>)}
      <Field label="Invoice due in (days)"><input type="number" min="0" value={draft.dueDays} onChange={event => change("dueDays", number(event.target.value))} /></Field>
      <Field label="Quotation valid for (days)"><input type="number" min="0" value={draft.qtnValidDays} onChange={event => change("qtnValidDays", number(event.target.value))} /></Field>
    </div><p className="muted tiny">Remember to update the financial-year prefix on 1 April. Current financial year: {year}–{String(year + 1).slice(2)}.</p></section>
    <section className="panel editor-section"><div className="section-heading"><div><h2>Terms and conditions</h2><p className="muted">Default text added to new invoices and quotations.</p></div></div><div className="form-grid two"><Field label="Invoice terms"><textarea rows={8} value={draft.terms} onChange={event => change("terms", event.target.value)} /></Field><Field label="Quotation terms"><textarea rows={8} value={draft.qtnTerms} onChange={event => change("qtnTerms", event.target.value)} /></Field></div></section>
    <div className="settings-save"><button className="button primary" onClick={() => onSave(draft)}>Save settings</button></div>
    <section className="panel editor-section"><div className="section-heading"><div><h2>Login security</h2><p className="muted">Signed in as {username}. Password is stored as a hash, never as plain text.</p></div></div><div className="form-grid two"><Field label="Current password"><input type="password" autoComplete="current-password" value={oldPassword} onChange={event => setOldPassword(event.target.value)} /></Field><Field label="New password (at least 12 characters)"><input type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} /></Field></div><div className="form-actions"><button className="button" disabled={newPassword.length < 12 || !oldPassword} onClick={() => void changePassword()}>Change password</button>{passwordMessage && <span className="muted">{passwordMessage}</span>}</div></section>
    <section className="panel editor-section"><div className="section-heading"><div><h2>Saved business data</h2><p className="muted">Your bills, contacts, items and company settings are securely saved.</p></div></div><div className="metric-grid compact"><Metric label="Documents" value={String(documentCount)} note="Saved records" icon="▤" /><Metric label="Customers & suppliers" value={String(partyCount)} note="Saved records" icon="♙" /><Metric label="Items" value={String(itemCount)} note="Saved records" icon="▦" /><Metric label="Last backup" value={lastBackup ? displayDate(lastBackup) : "Not downloaded yet"} note="Download a copy regularly" icon="↓" /></div></section>
    <section className="panel editor-section"><div className="section-heading"><div><h2>Backup and restore</h2><p className="muted">Export all records as JSON or restore from a previous RS Fabrication Billing backup.</p></div></div><div className="action-wrap"><button className="button" onClick={onBackup}>Download backup</button><label className="button file-button">Restore from backup<input type="file" accept=".json,application/json" hidden onChange={event => { onRestore(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button className="button danger" onClick={onErase}>Erase all data</button></div><p className="muted tiny">To move data from the old HTML app: open its Settings, download a backup JSON, then restore that file here.</p></section>
  </div>;
}

function ReportTable({ columns, rows, total, csv }: {
  columns: string[]; rows: unknown[][]; total?: unknown[]; csv?: { name: string; head: string[]; rows: unknown[][] };
}) {
  return <>
    <div className="table-scroll"><table className="data-table report-table"><thead><tr>{columns.map((column, index) => <th className={/amount|taxable|igst|cgst|sgst|rate|qty|value|count|total/i.test(column) ? "align-right" : ""} key={`${column}-${index}`}>{column}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, index) => <td className={/amount|taxable|igst|cgst|sgst|rate|qty|value|count|total/i.test(columns[index] || "") ? "align-right number" : ""} key={index}>{value as React.ReactNode}</td>)}</tr>)
        : <tr><td colSpan={columns.length} className="empty-table">No entries in this period.</td></tr>}
        {total && rows.length > 0 && <tr className="report-total">{total.map((value, index) => <td className={/amount|taxable|igst|cgst|sgst|rate|qty|value|count|total/i.test(columns[index] || "") ? "align-right number" : ""} key={index}>{value as React.ReactNode}</td>)}</tr>}
      </tbody></table></div>
    {csv && rows.length > 0 && <div className="csv-action"><button className="button small" onClick={() => csvDownload(csv.name, [csv.head, ...csv.rows])}>Download CSV</button></div>}
  </>;
}

function ReportSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <section className="panel report-section"><div className="section-heading"><div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div></div>{children}</section>;
}

function GSTPage({ company, report, period, periodType, setPeriodType, setPeriodKey, subTab, setSubTab }: {
  company: Company; report: GSTReport; period: Period; periodType: GSTPeriodType;
  setPeriodType: (value: GSTPeriodType) => void; setPeriodKey: (value: string) => void;
  subTab: GSTSub; setSubTab: (value: GSTSub) => void;
}) {
  const periodOptions = periods()[periodType];
  const g1 = report.g1;
  const f = format;
  const taxCols = ["Taxable", "IGST", "CGST", "SGST"];
  const taxValues = (value: { taxable?: number; i?: number; c?: number; s?: number }) => [f(value.taxable), f(value.i), f(value.c), f(value.s)];
  const gstr1Sections = () => {
    const summary = [
      ["4A · B2B invoices", g1.count.b2b, ...taxValues(g1.totals.b2b)],
      ["5 · B2C Large (inter-state above ₹1 lakh)", g1.count.b2cl, ...taxValues(g1.totals.b2cl)],
      ["7 · B2C Small", `${Object.keys(g1.b2cs).length} rows`, ...taxValues(g1.totals.b2cs)],
      ["8 · Nil rated", "", f(Object.values(g1.nil).reduce((sum, amount) => sum + amount, 0)), "0", "0", "0"],
      ["12 · HSN summary", `${Object.keys(g1.hsnB2B).length + Object.keys(g1.hsnB2C).length} rows`, ...taxValues(g1.totals.hsn)],
    ];
    const b2bRows = g1.b2b.map(row => [row.gstin, row.name, row.no, displayDate(row.date), f(row.value), row.pos, f(row.rate), ...taxValues(row)]);
    const b2clRows = g1.b2cl.map(row => [row.no, displayDate(row.date), f(row.value), row.pos, f(row.rate), f(row.taxable), f(row.i)]);
    const b2csRows = Object.values(g1.b2cs).map((row: GSTB2CSummary) => [row.type, row.pos, f(row.rate), ...taxValues(row)]);
    const hsnRows = (source: Record<string, GSTHSNRow>) => Object.values(source).sort((a, b) => a.hsn.localeCompare(b.hsn)).map(row => [row.hsn, row.desc, row.uqc, f(row.qty), f(row.rate), ...taxValues(row), f(round2(row.taxable + row.i + row.c + row.s))]);
    const docRows = Object.values(g1.docs).map((row: GSTDocumentSeries) => [row.series || "—", row.from, row.to, row.total, row.cancelled, row.total - row.cancelled]);
    const tag = period.label.replace(/[^\w-]+/g, "-");
    return <>
      <ReportSection title="GSTR-1 summary" subtitle={`${g1.count.invoices} invoices in period${g1.count.cancelled ? ` · ${g1.count.cancelled} cancelled (excluded from tax totals)` : ""} · Total tax ${money(g1.totals.all.i + g1.totals.all.c + g1.totals.all.s)}`}>
        <ReportTable columns={["Table", "Count", ...taxCols]} rows={summary} total={["Total (4A + 5 + 7)", "", ...taxValues(g1.totals.all)]} />
      </ReportSection>
      <ReportSection title="Table 4A · B2B supplies" subtitle="Invoice-wise, one row per GST rate.">
        <ReportTable columns={["GSTIN of recipient","Receiver name","Invoice no.","Date","Invoice value","Place of supply","Rate %",...taxCols]} rows={b2bRows} csv={{ name: `GSTR1 B2B ${tag}.csv`, head: ["GSTIN/UIN of Recipient","Receiver Name","Invoice Number","Invoice date","Invoice Value","Place Of Supply","Reverse Charge","Invoice Type","Rate","Taxable Value","Integrated Tax","Central Tax","State/UT Tax","Cess Amount"], rows: g1.b2b.map(row => [row.gstin,row.name,row.no,displayDate(row.date),row.value,row.pos,"N","Regular B2B",row.rate,row.taxable,row.i,row.c,row.s,0]) }} />
      </ReportSection>
      <ReportSection title="Table 5 · B2C Large" subtitle="Inter-state invoices to unregistered buyers above ₹1,00,000.">
        <ReportTable columns={["Invoice no.","Date","Invoice value","Place of supply","Rate %","Taxable","IGST"]} rows={b2clRows} csv={{ name: `GSTR1 B2CL ${tag}.csv`, head: ["Invoice Number","Invoice date","Invoice Value","Place Of Supply","Rate","Taxable Value","Integrated Tax","Cess Amount"], rows: g1.b2cl.map(row => [row.no,displayDate(row.date),row.value,row.pos,row.rate,row.taxable,row.i,0]) }} />
      </ReportSection>
      <ReportSection title="Table 7 · B2C Small" subtitle="Unregistered buyers grouped by place of supply and rate.">
        <ReportTable columns={["Type","Place of supply","Rate %",...taxCols]} rows={b2csRows} total={["Total","","",...taxValues(g1.totals.b2cs)]} csv={{ name: `GSTR1 B2CS ${tag}.csv`, head: ["Type","Place Of Supply","Rate","Taxable Value","Integrated Tax","Central Tax","State/UT Tax","Cess Amount"], rows: Object.values(g1.b2cs).map((row: GSTB2CSummary) => ["OE",row.pos,row.rate,row.taxable,row.i,row.c,row.s,0]) }} />
      </ReportSection>
      <ReportSection title="Table 8 · Nil rated, exempted and non-GST" subtitle="Summarised from items billed at 0% GST.">
        <ReportTable columns={["Description","Nil rated amount"]} rows={[["Inter-state to registered persons",f(g1.nil.interReg)],["Intra-state to registered persons",f(g1.nil.intraReg)],["Inter-state to unregistered persons",f(g1.nil.interUnreg)],["Intra-state to unregistered persons",f(g1.nil.intraUnreg)]]} />
      </ReportSection>
      {(["hsnB2B","hsnB2C"] as const).map(key => <ReportSection key={key} title={`Table 12 · HSN summary — ${key === "hsnB2B" ? "B2B" : "B2C"}`} subtitle="Services (SAC 99…) use UQC “NA” with quantity 0.">
        <ReportTable columns={["HSN/SAC","Description","UQC","Total qty","Rate %",...taxCols,"Total value"]} rows={hsnRows(g1[key])} csv={{ name: `GSTR1 HSN ${key === "hsnB2B" ? "B2B" : "B2C"} ${tag}.csv`, head: ["HSN","Description","UQC","Total Quantity","Total Value","Rate","Taxable Value","Integrated Tax Amount","Central Tax Amount","State/UT Tax Amount","Cess Amount"], rows: Object.values(g1[key]).map((row: GSTHSNRow) => [row.hsn,row.desc,row.uqc,row.qty,round2(row.taxable + row.i + row.c + row.s),row.rate,row.taxable,row.i,row.c,row.s,0]) }} />
      </ReportSection>)}
      <ReportSection title="Table 13 · Documents issued" subtitle="Outward invoices grouped by number series. Cancelled invoices remain listed.">
        <ReportTable columns={["Series","From","To","Total issued","Cancelled","Net issued"]} rows={docRows} csv={{ name: `GSTR1 Documents ${tag}.csv`, head: ["Nature of Document","Sr. No. From","Sr. No. To","Total Number","Cancelled"], rows: Object.values(g1.docs).map((row: GSTDocumentSeries) => ["Invoices for outward supply",row.from,row.to,row.total,row.cancelled]) }} />
      </ReportSection>
    </>;
  };
  const gstr3bSections = () => {
    const offset = report.offset;
    const interRows = report.interstate.map(row => [row.pos, f(row.taxable), f(row.i)]);
    return <>
      <ReportSection title="3.1 · Outward and reverse-charge supplies">
        <ReportTable columns={["Nature of supplies","Taxable","IGST","CGST","SGST","Cess"]} rows={[
          ["(a) Outward taxable supplies (other than zero, nil and exempted)",...taxValues(report.output),"0"],
          ["(b) Outward zero-rated supplies","0","0","0","0","0"],
          ["(c) Other outward supplies (nil rated, exempted)",f(report.nilOutput),"0","0","0","0"],
          ["(d) Inward supplies liable to reverse charge",...taxValues(report.rcm),"0"],
          ["(e) Non-GST outward supplies","0","0","0","0","0"],
        ]} />
      </ReportSection>
      <ReportSection title="3.2 · Inter-state supplies to unregistered persons" subtitle="Included under outward taxable supplies above.">
        <ReportTable columns={["Place of supply","Taxable","IGST"]} rows={interRows} />
      </ReportSection>
      <ReportSection title="4 · Eligible input tax credit" subtitle="Purchase bills with a valid supplier GSTIN. Match these figures against GSTR-2B before filing.">
        <ReportTable columns={["Details","IGST","CGST","SGST","Cess"]} rows={[
          ["(A)(3) Inward supplies liable to reverse charge",f(report.rcm.i),f(report.rcm.c),f(report.rcm.s),"0"],
          ["(A)(5) All other ITC",f(report.otherItc.i),f(report.otherItc.c),f(report.otherItc.s),"0"],
          ["(B) ITC reversed","0","0","0","0"],
          ["(C) Net ITC available",f(report.itc.i),f(report.itc.c),f(report.itc.s),"0"],
        ]} />
        {(report.noItc.i + report.noItc.c + report.noItc.s) > 0 && <p className="notice warning">Not counted as ITC: {money(report.noItc.i + report.noItc.c + report.noItc.s)} GST on purchases without a valid supplier GSTIN.</p>}
      </ReportSection>
      <ReportSection title="5 · Exempt, nil-rated and non-GST inward supplies">
        <ReportTable columns={["Nature of supplies","Inter-state","Intra-state"]} rows={[["Nil rated / exempt purchases",f(report.exempt.inter),f(report.exempt.intra)]]} />
      </ReportSection>
      <ReportSection title="6.1 · Payment of tax" subtitle="ITC set-off order is estimated here. Reverse charge tax is always shown as cash payable.">
        <ReportTable columns={["Tax","Payable","IGST credit","CGST credit","SGST credit","Cash (forward charge)","Cash (reverse charge)","Total cash"]} rows={[
          ["IGST",f(round2(report.output.i + report.rcm.i)),f(offset.used.i.i),f(offset.used.c.i),f(offset.used.s.i),f(offset.cash.i),f(report.rcm.i),f(report.cash.i)],
          ["CGST",f(round2(report.output.c + report.rcm.c)),f(offset.used.i.c),f(offset.used.c.c),"—",f(offset.cash.c),f(report.rcm.c),f(report.cash.c)],
          ["SGST",f(round2(report.output.s + report.rcm.s)),f(offset.used.i.s),"—",f(offset.used.s.s),f(offset.cash.s),f(report.rcm.s),f(report.cash.s)],
        ]} total={["Total",f(round2(report.output.i + report.output.c + report.output.s + report.rcm.i + report.rcm.c + report.rcm.s)),"","","",f(report.cash.i + report.cash.c + report.cash.s),f(report.rcm.i + report.rcm.c + report.rcm.s),f(report.cash.i + report.cash.c + report.cash.s)]} />
        <div className="gst-summary-cards"><Metric label="Estimated GST to pay in cash" value={money(report.cash.i + report.cash.c + report.cash.s)} note="Before interest and late fees" icon="₹" /><Metric label="ITC carried forward" value={money(offset.balance.i + offset.balance.c + offset.balance.s)} note={`IGST ${f(offset.balance.i)} · CGST ${f(offset.balance.c)} · SGST ${f(offset.balance.s)}`} icon="↪" /></div>
      </ReportSection>
    </>;
  };
  const purchaseRows = report.register.sort((a, b) => a.doc.date.localeCompare(b.doc.date)).map(row => [
    displayDate(row.doc.date), row.doc.no, row.doc.party?.name || "", row.doc.party?.gstin || "—", f(row.taxable), f(row.i), f(row.c), f(row.s),
    row.doc.rcm ? "Yes" : "No", row.doc.rcm ? "RCM" : row.eligibleSupplier ? "Eligible" : "No GSTIN",
  ]);
  const purchaseTotals = report.register.reduce((acc, row) => ({
    taxable: round2(acc.taxable + row.taxable), i: round2(acc.i + row.i), c: round2(acc.c + row.c), s: round2(acc.s + row.s),
  }), { taxable: 0, i: 0, c: 0, s: 0 });
  const warnings = subTab === "r1" ? g1.warn : subTab === "r3b" ? [...g1.warn.filter(warning => !/HSN/.test(warning)), ...report.warn] : report.warn;
  const tag = period.label.replace(/[^\w-]+/g, "-");
  return <div className="page-stack">
    <PageHeading title="GST reports" subtitle="Estimated return summaries from the bills and purchases saved here." />
    <div className="gst-toolbar">
      <div className="segmented">{([["r1","GSTR-1"],["r3b","GSTR-3B"],["pr","Purchase register"]] as Array<[GSTSub,string]>).map(([key,label]) => <button className={subTab === key ? "selected" : ""} key={key} onClick={() => setSubTab(key)}>{label}</button>)}</div>
      <select value={periodType} onChange={event => setPeriodType(event.target.value as GSTPeriodType)}><option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="fy">Financial year</option></select>
      <select value={period?.key || ""} onChange={event => setPeriodKey(event.target.value)}>{periodOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
      <span className="muted">{company.gstin || "Add GSTIN in Settings"} · {period.label}</span>
    </div>
    {warnings.length > 0 && <div className="notice warning align-start"><div><b>Check before filing ({warnings.length})</b><ul>{warnings.slice(0, 12).map((warning, index) => <li key={index}>{warning}</li>)}{warnings.length > 12 && <li>…and {warnings.length - 12} more</li>}</ul></div></div>}
    {subTab === "r1" ? gstr1Sections() : subTab === "r3b" ? gstr3bSections() :
      <ReportSection title="Purchase register (ITC)" subtitle="Every supplier bill recorded for this period. Tick entries against GSTR-2B.">
        <ReportTable columns={["Bill date","Bill no.","Supplier","GSTIN","Taxable","IGST","CGST","SGST","Reverse charge","ITC"]} rows={purchaseRows} total={["Total","","","",f(purchaseTotals.taxable),f(purchaseTotals.i),f(purchaseTotals.c),f(purchaseTotals.s),"",""]} csv={{ name: `Purchase register ${tag}.csv`, head: ["Bill date","Bill no","Supplier","GSTIN","Taxable","IGST","CGST","SGST","Reverse charge","ITC"], rows: report.register.map(row => [displayDate(row.doc.date),row.doc.no,row.doc.party?.name,row.doc.party?.gstin || "",row.taxable,row.i,row.c,row.s,row.doc.rcm ? "Y" : "N",row.doc.rcm ? "RCM" : row.eligibleSupplier ? "Eligible" : "No GSTIN"]) }} />
      </ReportSection>}
    <p className="muted tiny report-disclaimer">Figures come from bills saved here. Cancelled invoices and quotations are excluded from tax calculations. Credit/debit notes, amendments, interest and late fees are not included. Verify against your records and GST portal before filing.</p>
  </div>;
}
