import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCSV, parseStatement, parseDate, parseAmount, parseNarration, makeTxn,
  trainModel, evaluateModel, categoriseAll, ruleCategory, teach,
  cycleFor, project, analyze, generateDemo, DEMO, localAnswer, parseRupees, claudeTools, safeToSpend,
} from "../src/engine/index.js";

const demo = () => {
  const { csv, labels } = generateDemo();
  const { transactions } = parseStatement(csv);
  const txns = categoriseAll(transactions, trainModel());
  const a = analyze({ txns, settings: { incomeDay: 1, buffer: 500 }, goals: DEMO.goals, asOf: DEMO.asOf });
  return { txns, labels, a };
};

test("CSV parser handles quotes, embedded commas and CRLF", () => {
  const rows = parseCSV('a,b,c\r\n1,"x, y",3\r\n"he said ""hi""",5,6\r\n');
  assert.deepEqual(rows[1], ["1", "x, y", "3"]);
  assert.equal(rows[2][0], 'he said "hi"');
});

test("dates and amounts in Indian bank formats", () => {
  assert.equal(parseDate("12/09/26"), "2026-09-12");
  assert.equal(parseDate("12-Sep-2026"), "2026-09-12");
  assert.equal(parseDate("2026-09-12"), "2026-09-12");
  assert.equal(parseAmount("1,234.50"), 1234.5);
  assert.equal(parseAmount("(250)"), -250);
  assert.equal(parseAmount("₹ 99 Dr"), -99);
});

test("UPI narrations are split into payee, VPA and note", () => {
  const p = parseNarration("UPI/DR/624512345678/SWIGGY/ICIC/swiggy@icici/Order");
  assert.equal(p.name, "SWIGGY");
  assert.equal(p.vpa, "swiggy@icici");
  const h = parseNarration("UPI-ZOMATO LIMITED-zomato.order@hdfcbank-HDFC0000499-624512345678-Order");
  assert.equal(h.name, "ZOMATO LIMITED");
});

test("statement import: signed-amount layout, newest-first order, preamble rows", () => {
  const csv = "My Bank\nAccount 1234\nTxn Date,Description,Amount,Balance\n03/09/2026,UPI/DR/1234567890/BLINKIT/HDFC/blinkit@hdfcbank/x,-210.00,790.00\n01/09/2026,UPI/CR/1234567891/MOM/HDFC/mom@okhdfcbank/allowance,1000.00,1000.00\n";
  const { transactions, closingBalance } = parseStatement(csv);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].direction, "credit");
  assert.equal(transactions[1].amount, 210);
  assert.equal(closingBalance, 790);
});

test("statement import explains what is missing", () => {
  assert.throws(() => parseStatement("foo,bar\n1,2"), /column headers/);
});

test("brand rules beat the model, Instamart is groceries not delivery", () => {
  const t = makeTxn({ id: "x", date: "2026-09-01", amount: 300, direction: "debit", narration: "UPI/DR/624512345678/SWIGGY INSTAMART/ICIC/instamart@icici/Order" });
  assert.equal(ruleCategory(t).cat, "groceries");
});

test("categoriser generalises to merchants it never saw", () => {
  const m = evaluateModel(trainModel());
  assert.ok(m.accuracy >= 0.9, `pipeline accuracy ${m.accuracy}`);
  assert.ok(m.nTest >= 100);
});

test("demo statement is categorised almost perfectly", () => {
  const { txns, labels } = demo();
  const acc = txns.filter((t, i) => t.category === labels[i]).length / txns.length;
  assert.ok(acc >= 0.97, `demo accuracy ${acc}`);
});

test("a correction teaches the model", () => {
  const model = trainModel();
  const t = makeTxn({ id: "x", date: "2026-09-01", amount: 90, direction: "debit", narration: "UPI/DR/624512345678/ZORBA KITCHENETTE NEW/SBIN/q123@ybl/UPI" });
  teach(model, t, "groceries");
  teach(model, t, "groceries");
  assert.equal(model.predict(`${t.merchant} ${t.text}`).cat, "groceries");
});

test("budget cycle follows the allowance day", () => {
  const c = cycleFor("2026-09-12", 1);
  assert.equal(c.start, "2026-09-01");
  assert.equal(c.length, 30);
  assert.equal(c.dayIndex, 12);
  assert.equal(c.daysLeft, 19);
  const c5 = cycleFor("2026-09-03", 5);
  assert.equal(c5.start, "2026-08-05");
});

test("demo tells the PocketRunway story", () => {
  const { a } = demo();
  assert.equal(a.cycle.dayIndex, 12);
  assert.equal(a.forecast.lastFundedDay, 22);
  assert.ok(a.safe.daily > 0 && a.safe.daily < a.forecast.level, "safe pace is below current pace");
  assert.ok(a.alerts.some((x) => x.id === "pace-food_delivery"));
  assert.deepEqual(a.bills.map((b) => b.merchant), ["Jio Prepaid", "Spotify"]);
});

test("safe-to-spend lands exactly on the next allowance", () => {
  const { a } = demo();
  const res = a.levers.cap(a.safe.daily);
  assert.ok(res.lastFundedDay >= a.cycle.length - 0, `cap reaches ${res.lastFundedDay}`);
});

test("forecast beats the naive pace rule in backtest", () => {
  const { a } = demo();
  assert.ok(a.backtest.cases.length >= 3);
  assert.ok(a.backtest.maeModel <= a.backtest.maeNaive);
});

test("Monte Carlo range brackets the expected day", () => {
  const { a } = demo();
  const { p10, p90 } = a.forecast.mc;
  assert.ok(p10 <= a.forecast.lastFundedDay && a.forecast.lastFundedDay <= p90);
});

test("what-ifs move in the right direction", () => {
  const { a } = demo();
  const base = a.forecast.lastFundedDay;
  assert.ok(a.levers.purchase(2000).lastFundedDay < base);
  assert.ok(a.levers.skip(10) >= base);
  const days = a.levers.skipTable.map((r) => r.day);
  for (let i = 1; i < days.length; i++) assert.ok(days[i] >= days[i - 1]);
});

test("safe-to-spend never goes negative", () => {
  const c = cycleFor("2026-09-28", 1);
  const s = safeToSpend({ startBalance: 100, bills: [{ amount: 299 }], cycle: c, buffer: 500, spentToday: 0 });
  assert.equal(s.daily, 0);
});

test("assistant answers the core questions from the numbers", () => {
  const { a, txns } = demo();
  assert.equal(parseRupees("can I afford a ₹1,200 ticket?"), 1200);
  assert.equal(parseRupees("2.5k shoes"), 2500);
  assert.match(localAnswer("Why am I low?", a, txns).text, /Day 22/);
  assert.match(localAnswer("Can I afford a ₹1,200 concert ticket?", a, txns).text, /₹1,200/);
  assert.equal(localAnswer("where did my money go this week", a, txns).intent, "where");
  assert.equal(localAnswer("how much can I spend this weekend", a, txns).intent, "safe");
  assert.equal(localAnswer("when will I run out", a, txns).intent, "runway");
});

test("Claude tools return small, correct results", () => {
  const { a, txns } = demo();
  const tools = Object.fromEntries(claudeTools(a, txns).map((t) => [t.name, t]));
  const p = tools.simulate_purchase.execute({ amount_inr: 1500 });
  assert.ok(p.lastFundedDayAfter <= p.lastFundedDayBefore);
  const c = tools.simulate_cut.execute({ category: "food_delivery", count: 6 });
  assert.ok(c.lastFundedDayAfter >= c.lastFundedDayBefore);
  assert.ok(JSON.stringify(tools.list_transactions.execute({ days: 7 })).length < 32000);
});
