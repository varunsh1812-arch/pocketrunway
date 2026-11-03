// Bank-statement import: CSV text in, clean transactions out.
// Handles quoted CSV, preamble rows, debit/credit or signed-amount layouts,
// Indian date formats and the common UPI narration styles.

import { iso } from "./util.js";

export function detectDelimiter(line) {
  const counts = [",", ";", "\t", "|"].map((d) => [d, line.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** RFC 4180-style CSV parser (quotes, escaped quotes, CRLF, embedded newlines). */
export function parseCSV(text, delimiter) {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const d = delimiter ?? detectDelimiter(firstLine);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === d) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

const COLS = {
  date: [/^(txn|tran|transaction|posting|value)?\s*date$/i, /^date/i, /date$/i],
  narration: [/narration|description|particulars|remarks|details|transaction details|merchant|payee/i],
  debit: [/withdrawal|debit|^dr\b|paid out|money out|amount out|spent/i],
  credit: [/deposit|credit|^cr\b|paid in|money in|amount in|received/i],
  amount: [/^amount|^amt|amount \(inr\)|transaction amount/i],
  type: [/^type$|dr\s*\/\s*cr|cr\s*\/\s*dr|debit\/credit|txn type/i],
  balance: [/balance/i],
};

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = rows[i].map((c) => c.toLowerCase());
    const hasDate = cells.some((c) => /date/.test(c));
    const hasMoney = cells.some((c) => /amount|amt|debit|credit|withdrawal|deposit/.test(c));
    if (hasDate && hasMoney) return i;
  }
  return -1;
}

function mapColumns(header) {
  const used = new Set();
  const find = (key) => {
    for (const re of COLS[key]) {
      const idx = header.findIndex((h, i) => !used.has(i) && re.test(h));
      if (idx >= 0) {
        used.add(idx);
        return idx;
      }
    }
    return -1;
  };
  // value date is a fallback only: prefer the transaction date
  const m = {};
  m.date = find("date");
  m.balance = find("balance");
  m.debit = find("debit");
  m.credit = find("credit");
  m.amount = m.debit < 0 && m.credit < 0 ? find("amount") : -1;
  m.type = find("type");
  m.narration = find("narration");
  return m;
}

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function parseDate(raw, order = "dmy") {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i, "");
  let y;
  let m;
  let d;
  let mt;
  if ((mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) [, y, m, d] = mt.map(Number);
  else if ((mt = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,4})[-/. ,]*(\d{2,4})$/))) {
    d = Number(mt[1]);
    m = MON[mt[2].toLowerCase()];
    y = Number(mt[3]);
  } else if ((mt = s.match(/^([A-Za-z]{3,4})[-/. ](\d{1,2})[-/. ,]*(\d{2,4})$/))) {
    m = MON[mt[1].toLowerCase()];
    d = Number(mt[2]);
    y = Number(mt[3]);
  } else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    const a = Number(mt[1]);
    const b = Number(mt[2]);
    y = Number(mt[3]);
    if (order === "mdy") [m, d] = [a, b];
    else [d, m] = [a, b];
  } else return null;
  if (y < 100) y += 2000;
  if (!m || m > 12 || !d || d > 31) return null;
  return iso(new Date(Date.UTC(y, m - 1, d)));
}

export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s || s === "-") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/\bdr\.?$/i.test(s)) sign = -1;
  s = s.replace(/(inr|rs\.?|₹|cr\.?|dr\.?)/gi, "").replace(/[, ]/g, "");
  if (s.startsWith("-")) {
    sign *= -1;
    s = s.slice(1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

const titleCase = (s) =>
  s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Upi|Atm|Neft|Imps|Irctc|Pvr|Dmart|Hp|Vi|Bsnl|Act|Kfc|Byjus)\b/g, (w) => w.toUpperCase());

/** Pull the counterparty, VPA and note out of the usual narration styles. */
export function parseNarration(narration) {
  const n = (narration || "").replace(/\s+/g, " ").trim();
  let m;
  // UPI/DR/624512345678/SWIGGY/ICIC/swiggy@icici/Paid via PhonePe
  if ((m = n.match(/^UPI\/(?:DR|CR|P2M|P2A)?\/?(\d{6,})\/([^/]+)\/([^/]*)\/([^/]*)\/?(.*)$/i)))
    return { channel: "UPI", name: m[2].trim(), vpa: m[4].trim(), note: m[5].trim() };
  // UPI-ZOMATO LIMITED-zomato.order@hdfcbank-HDFC0000499-624512345678-Order
  if ((m = n.match(/^UPI[-/]([^/@]+?)[-/]([\w.]+@[\w]+)[-/ ]?(.*)$/i)))
    return { channel: "UPI", name: m[1].trim(), vpa: m[2].trim(), note: m[3].replace(/[A-Z]{4}0\w{6}|\d{8,}/g, "").replace(/[-/]+/g, " ").trim() };
  if ((m = n.match(/^(?:POS|PCD|ECOM)\s*[\w*X]*\s+(.+)$/i))) return { channel: "Card", name: m[1].trim(), vpa: "", note: "" };
  if ((m = n.match(/^(?:NEFT|IMPS|RTGS)[\s/-]*(?:CR|DR)?[\s/-]*(?:[A-Z]{4}0\w{6})?[\s/-]*([A-Za-z][^/-]*)/i)))
    return { channel: n.slice(0, 4).toUpperCase(), name: m[1].trim(), vpa: "", note: "" };
  if (/\bATM\b|CASH WDL|CASH WITHDRAWAL/i.test(n)) return { channel: "ATM", name: "Cash withdrawal", vpa: "", note: "" };
  return { channel: "Other", name: n.replace(/\d{6,}/g, "").replace(/[/_-]+/g, " ").trim(), vpa: "", note: "" };
}

export function makeTxn({ id, date, amount, direction, narration, balance = null, time = null }) {
  const p = parseNarration(narration);
  const merchant = titleCase(p.name || narration || "Unknown");
  return {
    id,
    date,
    time,
    amount: Math.abs(amount),
    direction,
    narration,
    channel: p.channel,
    merchant,
    vpa: p.vpa,
    note: p.note,
    merchantKey: (p.name || narration || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    text: [p.name, p.vpa, p.note].filter(Boolean).join(" "),
    balance,
  };
}

/**
 * Parse a statement CSV. Returns {transactions, warnings, columns, closingBalance}.
 * Throws an Error with a user-facing message when the file cannot be read as a statement.
 */
export function parseStatement(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error("The file is empty. Export your statement as CSV and try again.");
  const h = findHeader(rows);
  if (h < 0) throw new Error("Couldn't find the column headers. The file needs a Date column and Amount, Debit or Withdrawal columns.");
  const header = rows[h];
  const cols = mapColumns(header);
  if (cols.date < 0) throw new Error("Couldn't find a Date column.");
  if (cols.debit < 0 && cols.credit < 0 && cols.amount < 0) throw new Error("Couldn't find Amount, Debit or Credit columns.");
  const body = rows.slice(h + 1);
  // Decide day-first vs month-first from the data itself (Indian banks are day-first).
  let order = "dmy";
  for (const r of body) {
    const mt = (r[cols.date] || "").match(/^(\d{1,2})[-/.](\d{1,2})[-/.]/);
    if (mt && Number(mt[2]) > 12) order = "mdy";
    if (mt && Number(mt[1]) > 12) {
      order = "dmy";
      break;
    }
  }
  const out = [];
  const warnings = [];
  body.forEach((r, i) => {
    const date = parseDate(r[cols.date], order);
    if (!date) {
      if (r.join("").trim()) warnings.push(`Row ${h + i + 2}: skipped, unreadable date "${r[cols.date] ?? ""}"`);
      return;
    }
    let amount = 0;
    let direction;
    if (cols.amount >= 0) {
      const a = parseAmount(r[cols.amount]);
      if (a == null) return;
      const t = cols.type >= 0 ? (r[cols.type] || "").toLowerCase() : "";
      if (/^c|credit|deposit/.test(t)) direction = "credit";
      else if (/^d|debit|withdraw/.test(t)) direction = "debit";
      else direction = a < 0 ? "debit" : "credit";
      amount = Math.abs(a);
    } else {
      const dr = cols.debit >= 0 ? parseAmount(r[cols.debit]) : null;
      const cr = cols.credit >= 0 ? parseAmount(r[cols.credit]) : null;
      if (dr && Math.abs(dr) > 0) {
        direction = "debit";
        amount = Math.abs(dr);
      } else if (cr && Math.abs(cr) > 0) {
        direction = "credit";
        amount = Math.abs(cr);
      } else return;
    }
    const narration = cols.narration >= 0 ? r[cols.narration] : r.filter((_, j) => j !== cols.date).join(" ");
    const balance = cols.balance >= 0 ? parseAmount(r[cols.balance]) : null;
    out.push(makeTxn({ id: `t${out.length + 1}`, date, amount, direction, narration, balance }));
  });
  if (!out.length) throw new Error("No transactions found under the header row.");
  // Statements are often newest-first: sort oldest-first, keeping same-day order stable.
  const newestFirst = out.length > 1 && out[0].date > out[out.length - 1].date;
  const ordered = newestFirst ? [...out].reverse() : out;
  ordered.forEach((t, i) => (t.seq = i));
  ordered.sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1));
  ordered.forEach((t, i) => (t.id = `t${i + 1}`));
  const last = [...ordered].reverse().find((t) => t.balance != null);
  return {
    transactions: ordered,
    warnings,
    columns: Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v >= 0 ? header[v] : null])),
    closingBalance: last ? last.balance : null,
  };
}
