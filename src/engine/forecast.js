// The forecast engine: how much will you spend before the next allowance, and on
// which day does the money run out?
//
// 1. Recurring bills are detected from the history and scheduled separately.
// 2. Everyday spending gets a level (a shrinkage blend of this month's pace and
//    the decayed historical average) and day-of-week multipliers.
// 3. A Monte Carlo simulation bootstraps real past days (same weekday, rescaled
//    to the current level) to give a likely range, not just one date.
// Days on which the person had already run out are excluded from fitting, so
// "making do" at month-end is not mistaken for their normal pace.

import { addDays, diffDays, toDate, iso, daysInMonth, weekday, rangeDays, quantile, mean, median, rng } from "./util.js";

export const LOW_BALANCE = 300; // below this, a day counts as "constrained"

const ymd = (y, m, d) => iso(new Date(Date.UTC(y, m - 1, d)));

/** The budget cycle containing `asOf`, starting on the allowance day. */
export function cycleFor(asOf, incomeDay = 1) {
  const d = toDate(asOf);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 1;
  const dayIn = (yy, mm) => Math.min(incomeDay, daysInMonth(yy, mm));
  let start = ymd(y, m, dayIn(y, m));
  if (start > asOf) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    start = ymd(y, m, dayIn(y, m));
  }
  let ny = y;
  let nm = m + 1;
  if (nm === 13) {
    nm = 1;
    ny += 1;
  }
  const next = ymd(ny, nm, dayIn(ny, nm));
  return {
    start,
    next,
    end: addDays(next, -1),
    length: diffDays(next, start),
    dayIndex: diffDays(asOf, start) + 1,
    daysLeft: diffDays(next, asOf),
  };
}

/** End-of-day balance for every day from the first transaction to `asOf`. */
export function dailyBalances(txns, asOf, currentBalance = null) {
  const first = txns[0]?.date ?? asOf;
  const days = rangeDays(first, asOf);
  const hasCol = txns.length && txns.every((t) => t.balance != null);
  const end = {};
  if (hasCol) {
    let last = txns[0].balance + (txns[0].direction === "debit" ? txns[0].amount : -txns[0].amount);
    let i = 0;
    for (const d of days) {
      while (i < txns.length && txns[i].date === d) last = txns[i++].balance;
      end[d] = last;
    }
  } else {
    // Walk backwards from the known current balance.
    const net = {};
    for (const t of txns) net[t.date] = (net[t.date] || 0) + (t.direction === "credit" ? t.amount : -t.amount);
    let bal = currentBalance ?? 0;
    for (let k = days.length - 1; k >= 0; k--) {
      end[days[k]] = bal;
      bal -= net[days[k]] || 0;
    }
  }
  return end;
}

/** Bills that repeat each cycle: same merchant, similar amount, similar day. */
export function detectRecurring(txns, cycles, incomeDay) {
  const groups = {};
  for (const t of txns) {
    if (t.direction !== "debit" || t.category === "friends") continue;
    (groups[t.merchantKey] ||= []).push(t);
  }
  const out = [];
  for (const [key, list] of Object.entries(groups)) {
    const byCycle = {};
    for (const t of list) byCycle[cycleFor(t.date, incomeDay).start] = t;
    const hits = Object.keys(byCycle).filter((c) => cycles.includes(c));
    // a subscription or recharge needs two matching cycles; anything else needs three
    const isBillLike = list[0].category === "bills";
    if (hits.length < (isBillLike ? 2 : 3)) continue;
    const amounts = hits.map((c) => byCycle[c].amount);
    const med = median(amounts);
    if (amounts.some((a) => Math.abs(a - med) > 0.1 * med)) continue;
    const offsets = hits.map((c) => diffDays(byCycle[c].date, c));
    if (Math.max(...offsets) - Math.min(...offsets) > 4) continue;
    if (list.length > hits.length + 1) continue; // frequent merchant, not a bill
    const sample = list[list.length - 1];
    out.push({ key, merchant: sample.merchant, category: sample.category, amount: Math.round(med), offset: Math.round(median(offsets)) });
  }
  return out;
}

/**
 * Fit the everyday-spend model on unconstrained days strictly before `asOf`.
 * Returns level (₹/day), weekday multipliers and the bootstrap pools.
 */
export function fitModel({ txns, asOf, cycle, balances, recurringKeys, k = 6 }) {
  const daily = {};
  for (const t of txns) {
    if (t.direction !== "debit" || t.date >= asOf || recurringKeys.has(t.merchantKey)) continue;
    daily[t.date] = (daily[t.date] || 0) + t.amount;
  }
  const first = txns[0]?.date ?? asOf;
  const lookback = addDays(asOf, -120);
  const allDays = rangeDays(first > lookback ? first : lookback, addDays(asOf, -1));
  const usable = allDays.filter((d) => {
    const startBal = balances[addDays(d, -1)];
    return startBal == null || startBal >= LOW_BALANCE;
  });
  const vals = usable.map((d) => daily[d] || 0);
  const cap = quantile([...vals].sort((a, b) => a - b), 0.95) || 0;
  const w = (v) => Math.min(v, cap);

  const hist = usable.filter((d) => d < cycle.start);
  const mtd = usable.filter((d) => d >= cycle.start);
  let num = 0;
  let den = 0;
  for (const d of hist) {
    const wt = Math.pow(0.5, diffDays(cycle.start, d) / 45);
    num += wt * w(daily[d] || 0);
    den += wt;
  }
  const levelHist = den ? num / den : null;
  const levelMtd = mtd.length ? mean(mtd.map((d) => w(daily[d] || 0))) : null;
  const n = mtd.length;
  let level;
  if (levelHist == null) level = levelMtd ?? 0;
  else if (levelMtd == null) level = levelHist;
  else level = (n / (n + k)) * levelMtd + (k / (n + k)) * levelHist;

  const overall = mean(vals.map(w)) || 1;
  const pools = Array.from({ length: 7 }, () => []);
  for (const d of usable) pools[weekday(d)].push(daily[d] || 0);
  const mult = pools.map((p) => {
    const m = p.length ? mean(p.map(w)) : overall;
    return (p.length * m + 4 * overall) / (p.length + 4) / overall;
  });
  return { level, levelHist, levelMtd, mtdWeight: levelHist == null ? 1 : n / (n + k), mult, pools, poolMean: overall, nDays: usable.length, daily };
}

/** Upcoming recurring bills between `from` and the cycle end (inclusive). */
export function upcomingBills(recurring, cycle, from, txns) {
  return recurring
    .map((r) => ({ ...r, date: addDays(cycle.start, Math.min(r.offset, cycle.length - 1)) }))
    .filter((r) => r.date >= from && r.date <= cycle.end)
    .filter((r) => !txns.some((t) => t.merchantKey === r.key && t.date >= cycle.start && t.date <= cycle.end));
}

/**
 * Deterministic "at your current pace" projection from the start of `asOf`.
 * Returns the path, the last fully funded cycle day and end balance.
 * `extraSpend` (₹ on asOf) and `saving` (₹ total, spread over the remaining days) power what-ifs.
 */
export function project({ startBalance, cycle, asOf, model, bills, spentToday = 0, extraSpend = 0, saving = 0, dailyCap = null, levelScale = 1 }) {
  const days = rangeDays(asOf, cycle.end);
  let bal = startBalance - extraSpend;
  const perDaySaving = saving / days.length;
  const path = [];
  let lastFunded = null;
  let runout = null;
  for (const d of days) {
    let spend = model.level * levelScale * model.mult[weekday(d)];
    if (dailyCap != null) spend = Math.min(spend, dailyCap);
    spend = Math.max(0, spend - perDaySaving);
    if (d === asOf) spend = Math.max(spend, spentToday);
    for (const b of bills) if (b.date === d) spend += b.amount;
    bal -= spend;
    path.push({ date: d, balance: bal });
    if (bal < 0 && runout == null) runout = d;
  }
  if (runout == null) lastFunded = cycle.length;
  else lastFunded = diffDays(runout, cycle.start); // the day before runout, as a cycle-day index
  return { path, lastFundedDay: lastFunded, runoutDate: runout, endBalance: bal };
}

/** Monte Carlo over bootstrapped days. Returns likely range and per-day balance bands. */
export function simulate({ startBalance, cycle, asOf, model, bills, spentToday = 0, sims = 1500, seed = 7 }) {
  const r = rng(seed);
  const days = rangeDays(asOf, cycle.end);
  const scale = model.poolMean ? model.level / model.poolMean : 1;
  const allPool = model.pools.flat();
  const lastFunded = [];
  const endBal = [];
  const perDay = days.map(() => []);
  for (let s = 0; s < sims; s++) {
    let bal = startBalance;
    let lf = null;
    days.forEach((d, i) => {
      const pool = model.pools[weekday(d)].length >= 3 ? model.pools[weekday(d)] : allPool;
      let spend = pool.length ? pool[Math.floor(r() * pool.length)] * scale : model.level;
      if (d === asOf) spend = Math.max(spend, spentToday);
      for (const b of bills) if (b.date === d) spend += b.amount;
      bal -= spend;
      perDay[i].push(bal);
      if (bal < 0 && lf == null) lf = diffDays(d, cycle.start);
    });
    lastFunded.push(lf ?? cycle.length);
    endBal.push(bal);
  }
  const sorted = [...lastFunded].sort((a, b) => a - b);
  const sortedEnd = [...endBal].sort((a, b) => a - b);
  return {
    p10: Math.round(quantile(sorted, 0.1)),
    p50: Math.round(quantile(sorted, 0.5)),
    p90: Math.round(quantile(sorted, 0.9)),
    probRunout: lastFunded.filter((x) => x < cycle.length).length / sims,
    endBalance: { p10: quantile(sortedEnd, 0.1), p50: quantile(sortedEnd, 0.5), p90: quantile(sortedEnd, 0.9) },
    bands: days.map((d, i) => {
      const v = perDay[i].sort((a, b) => a - b);
      return { date: d, p10: quantile(v, 0.1), p50: quantile(v, 0.5), p90: quantile(v, 0.9) };
    }),
  };
}

/**
 * Backtest: for each past cycle, stand at day `checkDay`, forecast the last
 * funded day with only the data available then, and compare with what happened.
 * Also scores a naive "spent so far ÷ days so far" rule for reference.
 */
export function backtest({ txns, balances, incomeDay, recurring, checkDay = 12 }) {
  const cycles = [];
  if (!txns.length) return { cases: [] };
  let c = cycleFor(txns[0].date, incomeDay);
  const lastDate = txns[txns.length - 1].date;
  while (c.end <= lastDate) {
    if (c.start >= txns[0].date) cycles.push(c);
    c = cycleFor(c.next, incomeDay);
  }
  const cases = [];
  for (const cy of cycles) {
    const asOf = addDays(cy.start, checkDay - 1);
    const startBal = balances[addDays(asOf, -1)];
    if (startBal == null) continue;
    const past = txns.filter((t) => t.date < asOf);
    if (past.filter((t) => t.date < cy.start).length < 20) continue; // need some history
    const keys = new Set(recurring.map((r) => r.key));
    const model = fitModel({ txns: past, asOf, cycle: { ...cy, dayIndex: checkDay }, balances, recurringKeys: keys });
    const bills = upcomingBills(recurring, cy, asOf, past);
    const pred = project({ startBalance: startBal, cycle: cy, asOf, model, bills }).lastFundedDay;
    // actual: the first day the day's spending would have taken the balance below ₹100
    // before any money came in (a top-up from friends or family "rescued" it)
    let actual = cy.length;
    for (const d of rangeDays(asOf, cy.end)) {
      const prev = balances[addDays(d, -1)];
      const out = txns.filter((t) => t.date === d && t.direction === "debit").reduce((a, t) => a + t.amount, 0);
      if (prev != null && prev - out < 100) {
        actual = diffDays(d, cy.start);
        break;
      }
    }
    const spentSoFar = txns.filter((t) => t.direction === "debit" && t.date >= cy.start && t.date < asOf).reduce((a, t) => a + t.amount, 0);
    const pace = spentSoFar / (checkDay - 1);
    const naive = Math.min(cy.length, checkDay - 1 + Math.floor(startBal / Math.max(1, pace)));
    cases.push({ cycleStart: cy.start, predicted: pred, actual, naive });
  }
  const mae = (k) => (cases.length ? mean(cases.map((x) => Math.abs(x[k] - x.actual))) : null);
  return { cases, maeModel: mae("predicted"), maeNaive: mae("naive"), checkDay };
}
