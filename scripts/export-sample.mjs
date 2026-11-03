// Writes the synthetic demo statement to sample-data/ so you can try the CSV import.
import { writeFile, mkdir } from "node:fs/promises";
import { generateDemo, parseStatement } from "../src/engine/index.js";

const { csv } = generateDemo();
await mkdir("sample-data", { recursive: true });
await writeFile("sample-data/riya_hdfc_style_statement.csv", csv);

// The same spends in an SBI-style layout (newest first, "12 Sep 2026" dates, Debit/Credit columns)
const { transactions } = parseStatement(csv);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (d) => {
  const [y, m, day] = d.split("-");
  return `${day} ${MON[Number(m) - 1]} ${y}`;
};
const q = (x) => (/[",]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
const rows = transactions
  .filter((t) => t.date >= "2026-06-01")
  .map((t) => [fmt(t.date), fmt(t.date), t.narration, "", t.direction === "debit" ? t.amount.toFixed(2) : "", t.direction === "credit" ? t.amount.toFixed(2) : "", t.balance.toFixed(2)].map(q).join(","))
  .reverse();
await writeFile("sample-data/riya_sbi_style_statement.csv", ["State Bank of India (synthetic demo)", "", "Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance", ...rows].join("\n"));
console.log("wrote sample-data/*.csv");
