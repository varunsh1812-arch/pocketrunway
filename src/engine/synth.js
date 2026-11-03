// Riya's demo statement: 3+ months of realistic, fully synthetic student UPI
// spending, written out as an HDFC-style CSV so the demo goes through the same
// import path as a real statement. Nothing here is real personal data.
//
// Behaviour model: allowance on the 1st; everyday spends drawn per day with
// weekday effects; bills on fixed days; when the money runs out she borrows from
// a friend, tightens up for the rest of the month, and repays after the next
// allowance. In the current month food delivery runs hotter than usual.

import { rng, addDays, rangeDays, weekday, dayOfMonth, toDate } from "./util.js";
import { BRANDS, LOCAL_MERCHANTS, PEOPLE, PARENT } from "./taxonomy.js";

const brand = (name) => BRANDS.find((b) => b.name === name);

export const DEMO = {
  name: "Riya",
  start: "2026-04-01",
  asOf: "2026-09-12",
  openingBalance: 420,
  allowance: 12000,
  seed: 89,
  incomeDay: 1,
  goals: [{ id: "g1", name: "Goa trip fund", target: 5000, saved: 2000, deadline: "2026-12-20" }],
};

const pad = (n) => String(n).padStart(2, "0");
const ddmmyy = (s) => {
  const d = toDate(s);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)}`;
};

export function generateDemo(seed = DEMO.seed ?? 11, opts = {}) {
  const r = rng(seed);
  const hotDelivery = opts.hotDelivery ?? 1.38;
  const rows = [];
  let bal = DEMO.openingBalance;
  let debt = null; // {person, amount}
  let tight = false;
  const ref = () => `62${r.int(1000000000, 9999999999)}`;
  const time = (h0, h1) => `${pad(r.int(h0, h1))}:${pad(r.int(0, 59))}`;

  const push = (date, t, kind, amount, narration, label) => {
    amount = Math.round(amount);
    if (kind === "debit") bal -= amount;
    else bal += amount;
    rows.push({ date, time: t, kind, amount, narration, balance: bal, label });
  };
  const upiBrand = (date, t, name, amount, note = "Paid via PhonePe") => {
    const b = brand(name);
    push(date, t, "debit", amount, `UPI/DR/${ref()}/${b.name}/${b.bank}/${b.vpa}/${note}`, b.cat);
  };
  const upiLocal = (date, t, cat, amount) => {
    const name = r.pick(LOCAL_MERCHANTS[cat]);
    const vpa = r() < 0.5 ? `q${r.int(100000, 999999)}@ybl` : `${name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 10)}@paytm`;
    push(date, t, "debit", amount, `UPI/DR/${ref()}/${name}/${r.pick(["SBIN", "PUNB", "BARB", "UBIN"])}/${vpa}/UPI`, cat);
  };
  const p2p = (date, t, kind, person, amount, note) =>
    push(date, t, kind, amount, `UPI/${kind === "debit" ? "DR" : "CR"}/${ref()}/${person[0]}/${person[2]}/${person[1]}/${note}`, kind === "debit" ? "friends" : "income");

  // Spend only what the account can cover; otherwise borrow first (once a month).
  const spend = (date, fn, amount) => {
    if (bal - amount < 0) {
      if (debt) return; // already borrowed this month: skip the spend
      const person = r.pick(PEOPLE.slice(0, 4));
      const loan = r() < 0.5 ? 1000 : 1500;
      p2p(date, time(9, 13), "credit", person, loan, "till allowance");
      debt = { person, amount: loan };
      tight = true;
    }
    fn(amount);
  };

  const shoppingDays = {};
  const funDays = {};
  for (const date of rangeDays(DEMO.start, DEMO.asOf)) {
    const dom = dayOfMonth(date);
    const wd = weekday(date);
    const isToday = date === DEMO.asOf;
    const hot = date >= "2026-09-01" ? hotDelivery : 1;
    if (dom === 1) {
      tight = false;
      push(date, "09:12", "credit", DEMO.allowance, `UPI/CR/${ref()}/${PARENT[0]}/${PARENT[2]}/${PARENT[1]}/Monthly allowance`, "income");
      const month = toDate(date).getUTCMonth();
      shoppingDays[month] = [r.int(3, 26), r.int(3, 26), r() < 0.5 ? r.int(3, 26) : null];
      funDays[month] = r.int(5, 24);
    }
    if (isToday) {
      upiLocal(date, "08:41", "eating_out", 20);
      break;
    }
    const month = toDate(date).getUTCMonth();
    if (dom === 3 && debt) {
      p2p(date, time(10, 20), "debit", debt.person, debt.amount, "returning thanks");
      debt = null;
    }
    // bills
    if (dom === 15) spend(date, (a) => upiBrand(date, time(8, 22), "JIO PREPAID", a, "Recharge 28d"), 299);
    if (dom === 20) spend(date, (a) => upiBrand(date, "06:30", "SPOTIFY", a, "Premium Student"), 119);
    if (dom === 5 || dom === 19) spend(date, (a) => upiBrand(date, time(8, 10), "METRO CARD RECHARGE", a, "Card top-up"), 200);
    // income extras
    if (date === "2026-07-08") push(date, "15:20", "credit", 1800, "NEFT CR-HDFC0000240-PIXELSTACK STUDIO-Design gig invoice 07", "income");
    if (date === "2026-08-09") push(date, "16:05", "credit", 1500, "NEFT CR-HDFC0000240-PIXELSTACK STUDIO-Design gig invoice 08", "income");
    if (date === "2026-06-14") spend(date, (a) => push(date, "18:02", "debit", a, `ATM WDL/SBI CAMPUS BRANCH/${ref()}`, "other"), 500);

    const damp = tight ? 0.45 : 1;
    const weekend = wd === 0 || wd === 6;
    // canteen and chai
    if (!weekend) {
      const n = r.int(1, 3);
      for (let i = 0; i < n; i++) if (r() < damp + 0.3) spend(date, (a) => upiLocal(date, time(8, 18), "eating_out", a), r.lognormal(38, 0.45));
    } else if (r() < 0.6 * damp) {
      spend(date, (a) => (r() < 0.5 ? upiLocal(date, time(11, 21), "eating_out", a) : upiBrand(date, time(11, 21), r.pick(["CHAAYOS", "STARBUCKS", "MCDONALDS", "HALDIRAMS"]), a)), r.lognormal(210, 0.4));
    }
    // food delivery, mostly evenings and late nights
    const lam = [0.5, 0.32, 0.32, 0.32, 0.32, 0.55, 0.7][wd] * hot * damp;
    for (let i = r.poisson(lam); i > 0; i--) {
      const m = r() < 0.55 ? "SWIGGY" : r() < 0.9 ? "ZOMATO" : "DOMINOS PIZZA";
      spend(date, (a) => upiBrand(date, time(19, 23), m, a, "Order"), r.lognormal(255, 0.32));
    }
    // groceries and essentials
    if (r() < 0.28 * damp) {
      if (r() < 0.75) spend(date, (a) => upiBrand(date, time(10, 22), r.pick(["BLINKIT", "ZEPTO", "SWIGGY INSTAMART", "BIGBASKET"]), a, "Order"), r.lognormal(190, 0.45));
      else spend(date, (a) => upiLocal(date, time(10, 21), "groceries", a), r.lognormal(150, 0.45));
    }
    // local travel
    if (r() < 0.22 * damp) {
      if (r() < 0.8) spend(date, (a) => upiBrand(date, time(8, 22), r.pick(["RAPIDO", "RAPIDO", "UBER INDIA", "OLA CABS"]), a, "Ride"), r.lognormal(105, 0.45));
      else spend(date, (a) => upiLocal(date, time(8, 22), "travel", a), r.lognormal(90, 0.4));
    }
    if (date === "2026-07-10") spend(date, (a) => upiBrand(date, "21:40", "IRCTC", a, "Ticket booking"), 645);
    if (date === "2026-07-14") spend(date, (a) => upiBrand(date, "20:15", "IRCTC", a, "Ticket booking"), 645);
    // shopping a few times a month (skipped when tight)
    if (!tight && shoppingDays[month]?.includes(dom))
      spend(date, (a) => upiBrand(date, time(12, 23), r.pick(["MYNTRA", "AMAZON", "MEESHO", "FLIPKART", "AJIO"]), a, "Order"), r.lognormal(650, 0.45));
    if (!tight && funDays[month] === dom) spend(date, (a) => upiBrand(date, time(12, 20), r.pick(["BOOKMYSHOW", "PVR INOX"]), a, "Tickets"), r.lognormal(360, 0.25));
    // study
    if (!weekend && r() < 0.12) spend(date, (a) => upiLocal(date, time(9, 17), "education", a), r.lognormal(45, 0.6));
    if (dom === 9 && !tight) spend(date, (a) => upiLocal(date, time(11, 18), "education", a), r.lognormal(340, 0.2));
    // health
    if (dom === 17 && r() < 0.8) spend(date, (a) => upiLocal(date, time(10, 20), "health", a), r.lognormal(170, 0.4));
    // friends: splits out, paybacks in
    if (r() < 0.12 * damp) spend(date, (a) => p2p(date, time(13, 23), "debit", r.pick(PEOPLE), a, r.pick(["split", "dinner", "cab split", "movie"])), r.lognormal(240, 0.5));
    if (r() < 0.05) p2p(date, time(13, 23), "credit", r.pick(PEOPLE), Math.round(r.lognormal(200, 0.4)), "paying back");
  }

  // Give three of this month's payees names that say nothing about what they sell.
  // Amounts, dates and balances stay exactly the same; the model should be unsure.
  const renames = [["groceries", "SRI SAI ENTERPRISES", "q482913@ybl"], ["shopping", "NAVKAR TRADING CO", "navkartrading@paytm"], ["travel", "SHIV SHAKTI MOTORS", "q771204@ybl"]];
  for (const [label, name, vpa] of renames) {
    const row = rows.find((x) => x.date >= "2026-09-01" && x.label === label && x.kind === "debit" && !x.renamed);
    if (!row) continue;
    const refNo = (row.narration.match(/(\d{12})/) || ["624500000000"])[0];
    row.narration = `UPI/DR/${refNo}/${name}/BARB/${vpa}/UPI`;
    row.renamed = true;
  }

  const header = "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance";
  const lines = rows.map((x) => {
    const refNo = (x.narration.match(/(\d{12})/) || [])[1] || "";
    const narr = `"${x.narration.replace(/"/g, '""')}"`;
    return [ddmmyy(x.date), narr, refNo, ddmmyy(x.date), x.kind === "debit" ? x.amount.toFixed(2) : "", x.kind === "credit" ? x.amount.toFixed(2) : "", x.balance.toFixed(2)].join(",");
  });
  const preamble = ["HDFC BANK Ltd. (synthetic demo statement)", "Account holder: RIYA (fictional persona)", "Statement period: 01/04/26 to 12/09/26", ""];
  return {
    csv: [...preamble, header, ...lines].join("\n"),
    labels: rows.map((x) => x.label),
    times: rows.map((x) => x.time),
  };
}

export const demoDayCount = () => rangeDays(DEMO.start, DEMO.asOf).length;
export { addDays };
