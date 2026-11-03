// One call that turns categorised transactions into everything the app shows.

import { addDays, diffDays, rangeDays, todayISO } from "./util.js";
import { cycleFor, dailyBalances, detectRecurring, fitModel, upcomingBills, project, simulate, backtest } from "./forecast.js";
import { safeToSpend, categoryPace, goalStatus, whatIfs, buildAlerts } from "./insights.js";

export * from "./util.js";
export * from "./taxonomy.js";
export * from "./parse.js";
export * from "./categorise.js";
export * from "./forecast.js";
export * from "./insights.js";
export { generateDemo, DEMO } from "./synth.js";
export * from "./assistant.js";

/**
 * @param {object} p
 * @param {Array} p.txns categorised transactions, oldest first
 * @param {object} p.settings {incomeDay, buffer, currentBalance?}
 * @param {Array} p.goals
 * @param {string} [p.asOf] analysis date (defaults to the last transaction date)
 */
export function analyze({ txns, settings, goals = [], asOf }) {
  const incomeDay = settings.incomeDay || 1;
  const buffer = settings.buffer ?? 500;
  const lastDate = txns.length ? txns[txns.length - 1].date : todayISO();
  asOf = asOf || lastDate;
  const cycle = cycleFor(asOf, incomeDay);
  const balances = dailyBalances(txns, asOf, settings.currentBalance ?? null);
  const yesterday = addDays(asOf, -1);
  const todays = txns.filter((t) => t.date === asOf);
  const spentToday = todays.filter((t) => t.direction === "debit").reduce((a, t) => a + t.amount, 0);
  const inToday = todays.filter((t) => t.direction === "credit").reduce((a, t) => a + t.amount, 0);
  const balanceNow = balances[asOf] ?? settings.currentBalance ?? 0;
  // Start-of-day balance, counting money that arrived today but not today's spending
  const startBalance = (balances[yesterday] ?? balanceNow + spentToday - inToday) + inToday;

  // past cycle starts (for recurring detection)
  const cycles = [];
  for (let c = cycleFor(addDays(cycle.start, -1), incomeDay); txns.length && c.start >= addDays(txns[0].date, -31) && cycles.length < 4; c = cycleFor(addDays(c.start, -1), incomeDay)) cycles.push(c.start);
  const recurring = detectRecurring(txns.filter((t) => t.date < cycle.start), cycles, incomeDay);
  const recurringKeys = new Set(recurring.map((r) => r.key));
  const bills = upcomingBills(recurring, cycle, asOf, txns.filter((t) => t.date <= asOf));
  const model = fitModel({ txns, asOf, cycle, balances, recurringKeys });

  const expected = project({ startBalance, cycle, asOf, model, bills, spentToday });
  const mc = simulate({ startBalance, cycle, asOf, model, bills, spentToday });
  const safe = safeToSpend({ startBalance, bills, cycle, buffer, spentToday });
  const pace = categoryPace({ txns, cycle, asOf, incomeDay });
  const forecast = { ...expected, level: model.level, model, mc, shortBy: Math.max(0, cycle.length - expected.lastFundedDay) };
  const levers = whatIfs({ startBalance, cycle, asOf, model, bills, spentToday, pace });
  const alerts = buildAlerts({ cycle, forecast, safe, pace, bills, txns, asOf });
  const goalList = goals.map((g) => goalStatus(g, asOf));

  // actual balance path for this cycle (end of day), for the chart
  const actualPath = rangeDays(cycle.start, yesterday >= cycle.start ? yesterday : cycle.start)
    .filter((d) => d < asOf)
    .map((d) => ({ date: d, balance: balances[d] }));
  const cycleStartBalance = balances[addDays(cycle.start, -1)];

  const bt = backtest({ txns: txns.filter((t) => t.date < cycle.start), balances, incomeDay, recurring });
  const spentThisCycle = txns.filter((t) => t.direction === "debit" && t.date >= cycle.start && t.date <= asOf).reduce((a, t) => a + t.amount, 0);
  const inThisCycle = txns.filter((t) => t.direction === "credit" && t.date >= cycle.start && t.date <= asOf).reduce((a, t) => a + t.amount, 0);

  return {
    asOf,
    cycle,
    balanceNow,
    startBalance,
    spentToday,
    spentThisCycle,
    inThisCycle,
    cycleStartBalance,
    safe,
    forecast,
    bills,
    recurring,
    pace,
    alerts,
    goals: goalList,
    levers,
    actualPath,
    backtest: bt,
    stats: { txCount: txns.length, days: txns.length ? diffDays(lastDate, txns[0].date) + 1 : 0, fitDays: model.nDays },
  };
}
