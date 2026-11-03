// Dev tool: scans demo-data seeds and prints the ones whose September tells the deck's story.
// Usage: node scripts/calibrate.mjs 400
import { generateDemo, DEMO, parseStatement, trainModel, categoriseAll, analyze } from "../src/engine/index.js";
const N = Number(process.argv[2] || 400);
const out = [];
const model = trainModel();
for (let seed = 1; seed <= N; seed++) {
  const { csv, labels } = generateDemo(seed);
  const { transactions } = parseStatement(csv);
  const txns = categoriseAll(transactions, model);
  const acc = txns.filter((t, i) => t.category === labels[i]).length / txns.length;
  const a = analyze({ txns, settings: { incomeDay: 1, buffer: 500 }, goals: DEMO.goals, asOf: DEMO.asOf });
  const fd = a.pace.find((p) => p.id === "food_delivery");
  const fdPct = fd?.ratio ? Math.round((fd.ratio - 1) * 100) : null;
  const row = { seed, acc: +acc.toFixed(3), bal: Math.round(a.startBalance), safe: a.safe.daily, last: a.forecast.lastFundedDay, p10: a.forecast.mc.p10, p50: a.forecast.mc.p50, p90: a.forecast.mc.p90, fdPct, bills: a.bills.map(b=>b.merchant).join("|"), mae: a.backtest.maeModel, naive: a.backtest.maeNaive, cases: a.backtest.cases.map(c=>`${c.predicted}/${c.naive}/${c.actual}`).join(" "), skips: a.levers.skipsToFinish, alerts: a.alerts.map(x=>x.id).join(",") };
  const ok = row.safe >= 200 && row.safe <= 290 && row.last >= 20 && row.last <= 24;
  if (ok) out.push(row);
}
console.table(out.slice(0, 30));
console.log("matches:", out.length);
