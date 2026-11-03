// The rules engine: ordinary, explainable software on top of the AI outputs.
// Safe-to-spend, category pace vs usual, alerts, goals and what-if levers.

import { addDays, diffDays, rangeDays, mean, median, rupees, shortDate, round } from "./util.js";
import { catLabel } from "./taxonomy.js";
import { cycleFor, project } from "./forecast.js";

/** ₹ you can spend today and still reach the next allowance with a buffer left. */
export function safeToSpend({ startBalance, bills, cycle, buffer, spentToday, goalReserve = 0 }) {
  const billTotal = bills.reduce((a, b) => a + b.amount, 0);
  const available = startBalance - billTotal - buffer - goalReserve;
  const daily = Math.max(0, Math.floor(available / cycle.daysLeft / 10) * 10);
  return { daily, available, billTotal, buffer, goalReserve, leftToday: daily - spentToday, spentToday, daysLeft: cycle.daysLeft };
}

/** This cycle's spend by category vs the usual spend by the same day of past cycles. */
export function categoryPace({ txns, cycle, asOf, incomeDay }) {
  const past = [];
  let c = cycleFor(addDays(cycle.start, -1), incomeDay);
  while (txns.length && c.start >= addDays(txns[0].date, -1) && past.length < 3) {
    past.push(c);
    c = cycleFor(addDays(c.start, -1), incomeDay);
  }
  const n = cycle.dayIndex;
  const byCat = {};
  const add = (cat, key, amt) => {
    byCat[cat] ||= { id: cat, label: catLabel(cat), now: 0, past: {}, count: 0, orders: [] };
    if (key === "now") byCat[cat].now += amt;
    else byCat[cat].past[key] = (byCat[cat].past[key] || 0) + amt;
  };
  for (const t of txns) {
    if (t.direction !== "debit") continue;
    if (t.date >= cycle.start && t.date <= asOf) {
      add(t.category, "now", t.amount);
      byCat[t.category].count++;
    }
    for (const p of past) {
      if (t.date >= p.start && diffDays(t.date, p.start) < n) add(t.category, p.start, t.amount);
    }
    if (t.date < asOf) (byCat[t.category] ||= { id: t.category, label: catLabel(t.category), now: 0, past: {}, count: 0, orders: [] }).orders.push(t.amount);
  }
  return Object.values(byCat)
    .map((c) => {
      const usual = past.length ? mean(past.map((p) => c.past[p.start] || 0)) : null;
      return {
        id: c.id,
        label: c.label,
        now: c.now,
        usual,
        delta: usual == null ? null : c.now - usual,
        ratio: usual ? c.now / usual : null,
        count: c.count,
        avgOrder: c.orders.length ? median(c.orders) : 0,
      };
    })
    .sort((a, b) => b.now - a.now);
}

export function goalStatus(goal, asOf) {
  const weeksLeft = Math.max(1, diffDays(goal.deadline, asOf) / 7);
  const remaining = Math.max(0, goal.target - goal.saved);
  return {
    ...goal,
    progress: Math.min(1, goal.saved / goal.target),
    remaining,
    weeksLeft: Math.round(weeksLeft),
    perWeek: Math.ceil(remaining / weeksLeft / 10) * 10,
    done: remaining === 0,
  };
}

/** What-if levers. All reuse the same deterministic projection as the headline. */
export function whatIfs(ctx) {
  const { startBalance, cycle, asOf, model, bills, spentToday, pace } = ctx;
  const base = project({ startBalance, cycle, asOf, model, bills, spentToday });
  const delivery = pace.find((p) => p.id === "food_delivery");
  const order = delivery?.avgOrder || 250;
  const skip = (k) => project({ startBalance, cycle, asOf, model, bills, spentToday, saving: k * order }).lastFundedDay;
  const skipTable = [0, 1, 2, 3, 4, 6, 8, 10].map((k) => ({ k, day: skip(k) }));
  let toFinish = null;
  for (let k = 0; k <= 30; k++) if (skip(k) >= cycle.length) {
    toFinish = k;
    break;
  }
  return {
    base,
    order,
    skipTable,
    skip,
    skipsToFinish: toFinish,
    purchase: (amount) => project({ startBalance, cycle, asOf, model, bills, spentToday, extraSpend: amount }),
    save: (amount) => project({ startBalance, cycle, asOf, model, bills, spentToday, saving: amount }),
    cap: (c) => project({ startBalance, cycle, asOf, model, bills, spentToday, dailyCap: c }),
  };
}

/** Plain-language alerts, most important first. Severity: critical | warning | info | good */
export function buildAlerts({ cycle, forecast, safe, pace, bills, txns, asOf }) {
  const alerts = [];
  const shortBy = cycle.length - forecast.lastFundedDay;
  if (shortBy > 0)
    alerts.push({ id: "runway", severity: "critical", title: `Short by ${shortBy} day${shortBy > 1 ? "s" : ""} at the current pace`, body: `Your money lasts until Day ${forecast.lastFundedDay} of ${cycle.length}. Staying at ${rupees(safe.daily)} a day gets you to Day ${cycle.length}.` });
  else alerts.push({ id: "runway", severity: "good", title: "On track to your next allowance", body: `At this pace you reach Day ${cycle.length} with about ${rupees(forecast.endBalance)} left.` });
  for (const p of pace) {
    if (p.usual && p.ratio >= 1.25 && p.delta >= 300 && p.id !== "friends" && p.id !== "other")
      alerts.push({ id: `pace-${p.id}`, severity: "warning", category: p.id, title: `${p.label} is ${Math.round((p.ratio - 1) * 100)}% above your usual`, body: `${rupees(p.now)} so far this month vs about ${rupees(p.usual)} by Day ${cycle.dayIndex} usually.` });
  }
  if (safe.spentToday > safe.daily && safe.daily > 0)
    alerts.push({ id: "today", severity: "warning", title: `Today is ${rupees(safe.spentToday - safe.daily)} over your safe amount`, body: "Tomorrow's safe-to-spend will be a little lower to make up for it." });
  const soon = bills.filter((b) => diffDays(b.date, asOf) <= 7);
  for (const b of soon) alerts.push({ id: `bill-${b.key}`, severity: "info", title: `${b.merchant} ${rupees(b.amount)} due around ${shortDate(b.date)}`, body: "Already set aside in your safe-to-spend." });
  const thisCycle = txns.filter((t) => t.direction === "debit" && t.category !== "friends" && t.date >= cycle.start && t.date <= asOf);
  if (thisCycle.length) {
    const big = thisCycle.reduce((a, t) => (t.amount > a.amount ? t : a));
    const typical = median(thisCycle.map((t) => t.amount));
    if (big.amount >= Math.max(600, typical * 4))
      alerts.push({ id: "big", severity: "info", title: `Biggest spend: ${big.merchant} ${rupees(big.amount)}`, body: `On ${shortDate(big.date)}. A typical spend for you is about ${rupees(typical)}.` });
  }
  return alerts;
}

export { round };
