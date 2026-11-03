// The assistant. Two brains, one contract:
//  - localAnswer(): an on-device intent engine that answers the common questions
//    from the computed numbers (works offline and everywhere);
//  - claudeRequest(): the same data plus page tools, for Claude to answer any
//    question in plain language when the app runs inside Claude.

import { rupees, shortDate, addDays, diffDays, pct } from "./util.js";
import { catLabel, CATEGORIES } from "./taxonomy.js";
import { safeToSpend } from "./insights.js";

export function parseRupees(text) {
  const m = text.replace(/,/g, "").match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)\s*(k)?|(\d+(?:\.\d+)?)\s*(k)?\s*(?:rs|rupees|₹)?/i);
  if (!m) return null;
  const n = Number(m[1] ?? m[3]);
  const k = m[2] ?? m[4];
  return Number.isFinite(n) ? Math.round(k ? n * 1000 : n) : null;
}

const findCategory = (text) => {
  const t = text.toLowerCase();
  const map = [
    ["food_delivery", /swiggy|zomato|deliver|order(ing)? food|takeaway/],
    ["eating_out", /canteen|chai|cafe|eat(ing)? out|restaurant|coffee/],
    ["groceries", /grocer|blinkit|zepto|instamart|essentials/],
    ["travel", /travel|cab|uber|ola|rapido|auto|metro|train/],
    ["shopping", /shop|myntra|amazon|flipkart|clothes|meesho/],
    ["entertainment", /movie|entertain|concert|bookmyshow|fun|game/],
    ["bills", /bill|recharge|subscription|spotify|netflix|jio/],
    ["education", /study|print|xerox|book|stationery/],
    ["health", /health|medic|pharmacy|gym|doctor/],
    ["friends", /friend|split|borrow|lend|loan/],
  ];
  return map.find(([, re]) => re.test(t))?.[0] ?? null;
};

function spendSince(txns, from, to) {
  const by = {};
  let total = 0;
  for (const t of txns) {
    if (t.direction !== "debit" || t.date < from || t.date > to) continue;
    by[t.category] = (by[t.category] || 0) + t.amount;
    total += t.amount;
  }
  return { total, rows: Object.entries(by).sort((a, b) => b[1] - a[1]) };
}

/** On-device answers. Returns {text, intent}. */
export function localAnswer(question, a, txns) {
  const q = question.toLowerCase();
  const amt = parseRupees(question);
  const { cycle, safe, forecast, levers } = a;
  const len = cycle.length;
  const shortBy = len - forecast.lastFundedDay;

  if (/afford|can i (buy|get|go|order|pay)|should i (buy|get|order)|is it ok to (buy|spend)|purchase/.test(q) && !/how much/.test(q)) {
    if (!amt) return { intent: "afford", text: "Tell me the price and I'll check it. For example: \"Can I afford a ₹1,200 concert ticket?\"" };
    const res = levers.purchase(amt);
    const newSafe = safeToSpend({ startBalance: a.startBalance - amt, bills: a.bills, cycle, buffer: safe.buffer, spentToday: a.spentToday }).daily;
    const lost = forecast.lastFundedDay - res.lastFundedDay;
    if (a.startBalance - amt - safe.billTotal < 0)
      return { intent: "afford", text: `Not right now. ${rupees(amt)} is more than you have left after your upcoming bills (${rupees(a.startBalance - safe.billTotal)}).` };
    const verdict = newSafe >= 150 ? "You can, but it costs you." : "I'd hold off.";
    return {
      intent: "afford",
      text: `${verdict} Spending ${rupees(amt)} today drops your safe-to-spend from ${rupees(safe.daily)} to ${rupees(newSafe)} a day for the next ${cycle.daysLeft} days${lost > 0 ? `, and at your current pace the money would run out ${lost} day${lost > 1 ? "s" : ""} earlier (Day ${res.lastFundedDay})` : ""}. ${newSafe >= 150 ? "If it matters to you, plan a few cheaper days to make room." : "Waiting until your next allowance on " + shortDate(cycle.next) + " keeps you safe."}`,
    };
  }
  if (/why|what('s| is) (wrong|happening)|low|short|broke|running out/.test(q) && !/how much/.test(q)) {
    const drivers = a.pace.filter((p) => p.usual && p.delta > 200 && p.id !== "friends" && p.id !== "other").slice(0, 3);
    const parts = drivers.map((p) => `${p.label} is ${rupees(p.delta)} above usual (${rupees(p.now)} vs ${rupees(p.usual)} by Day ${cycle.dayIndex})`);
    const head = shortBy > 0 ? `At this pace your money lasts until Day ${forecast.lastFundedDay}, ${shortBy} days short of your next allowance.` : `You're actually on track to reach Day ${len}.`;
    return {
      intent: "why",
      text: `${head} ${parts.length ? "The main reasons: " + parts.join("; ") + "." : "No single category is far above your usual; it's the everyday spending adding up."} You're averaging ${rupees(forecast.level)} a day, and the safe pace is ${rupees(safe.daily)}.`,
    };
  }
  if (/when|run out|last|runway|how long|till|until/.test(q) && !/how much/.test(q)) {
    const mc = forecast.mc;
    return {
      intent: "runway",
      text: shortBy > 0
        ? `At your current pace (about ${rupees(forecast.level)} a day) the money lasts until Day ${forecast.lastFundedDay} of ${len} (${shortDate(addDays(cycle.start, forecast.lastFundedDay - 1))}). Allowing for normal ups and downs, it's likely between Day ${mc.p10} and Day ${mc.p90}. There's a ${pct(mc.probRunout)} chance of running out before ${shortDate(cycle.next)}.`
        : `You're on track: at this pace you reach your next allowance on ${shortDate(cycle.next)} with about ${rupees(forecast.endBalance)} left.`,
    };
  }
  if (/how much|safe|budget|spend today|left|weekend|this week|per day|daily/.test(q) && !/where|went|spent on/.test(q)) {
    if (/weekend/.test(q)) {
      const days = [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(a.asOf, k)).filter((d) => d <= cycle.end && [0, 6].includes(new Date(d).getUTCDay()));
      return { intent: "safe", text: `Keep the weekend to about ${rupees(safe.daily * Math.max(1, days.length))} (${rupees(safe.daily)} a day). Today you have ${rupees(Math.max(0, safe.leftToday))} left.` };
    }
    if (/week/.test(q)) return { intent: "safe", text: `For the next 7 days, about ${rupees(safe.daily * 7)} in total keeps you on track (${rupees(safe.daily)} a day). Today you have ${rupees(Math.max(0, safe.leftToday))} left.` };
    return { intent: "safe", text: `You can safely spend ${rupees(safe.daily)} today and still reach ${shortDate(cycle.next)} with your ${rupees(safe.buffer)} buffer. You've spent ${rupees(a.spentToday)} so far today, so ${rupees(Math.max(0, safe.leftToday))} is left. Upcoming bills (${rupees(safe.billTotal)}) are already set aside.` };
  }
  if (/where|went|spent on|breakdown|categor|top spend|biggest/.test(q)) {
    const week = /week/.test(q);
    const from = week ? addDays(a.asOf, -6) : cycle.start;
    const { total, rows } = spendSince(txns, from, a.asOf);
    const top = rows.slice(0, 3).map(([c, v]) => `${catLabel(c)} ${rupees(v)} (${pct(v / total)})`);
    return { intent: "where", text: `${week ? "In the last 7 days" : `Since ${shortDate(cycle.start)}`} you've spent ${rupees(total)}. Top: ${top.join(", ")}.` };
  }
  if (/goal|trip|save|saving|goa/.test(q)) {
    const g = a.goals[0];
    if (!g) return { intent: "goal", text: "You don't have a savings goal yet. Add one in Goals and I'll tell you how much to set aside each week." };
    return { intent: "goal", text: `${g.name}: ${rupees(g.saved)} of ${rupees(g.target)} saved (${pct(g.progress)}). Putting away ${rupees(g.perWeek)} a week gets you there by ${shortDate(g.deadline)}. ${shortBy > 0 ? "Fix the runway first: this month there's nothing spare to move." : "This month you have room to move a little now."}` };
  }
  if (/skip|cut|reduce|fix|tip|help|save money|stop/.test(q)) {
    const cat = findCategory(q) || "food_delivery";
    const row = levers.skipTable.find((r) => r.k === 4);
    return {
      intent: "fix",
      text: `Two levers that work: 1) Stay at ${rupees(safe.daily)} a day and you reach Day ${len}. 2) ${cat === "food_delivery" ? `Each delivery order you skip saves about ${rupees(levers.order)}; skipping 4 gets you to Day ${row?.day}.` : `Cutting ${catLabel(cat).toLowerCase()} back to your usual pace helps too.`} ${levers.skipsToFinish != null ? `Skipping ${levers.skipsToFinish} orders on its own would reach Day ${len}.` : ""}`.trim(),
    };
  }
  return {
    intent: "help",
    text: `I can answer things like "Why am I low?", "Can I afford a ₹1,200 ticket?", "How much can I spend this weekend?", "Where did my money go this week?" or "How do I reach my trip goal?".`,
  };
}

// ---------- Claude ----------

export const RULES = `You are the assistant inside PocketRunway, a money-runway app for Indian students and first-time earners living on a fixed monthly allowance or salary.
Answer the user's question in 2 to 5 short sentences of plain text (no markdown, no headings, no bullet lists). Write amounts as ₹ with Indian digit grouping (₹1,200).
Use only numbers from DATA or from tool results; never invent transactions, balances or dates. If DATA cannot answer, say what you'd need.
Give budgeting guidance only. Do not give investment, credit, loan or insurance advice; if asked, say PocketRunway only helps with day-to-day budgeting.
Be warm and specific, never preachy. Prefer one concrete next step.
For "can I afford" questions call simulate_purchase. For "what if I skip or cut" questions call simulate_cut. Call spend_by_category or list_transactions when you need detail beyond DATA.`;

export function contextJSON(a) {
  const { cycle, safe, forecast } = a;
  return JSON.stringify({
    today: a.asOf,
    cycle: { start: cycle.start, nextAllowance: cycle.next, day: cycle.dayIndex, length: cycle.length, daysLeftIncludingToday: cycle.daysLeft },
    balanceStartOfToday: Math.round(a.startBalance),
    spentToday: Math.round(a.spentToday),
    safeToSpendPerDay: safe.daily,
    leftToday: Math.max(0, safe.leftToday),
    bufferKept: safe.buffer,
    upcomingBills: a.bills.map((b) => ({ name: b.merchant, amount: b.amount, date: b.date })),
    forecast: {
      averageDailySpend: Math.round(forecast.level),
      moneyLastsUntilDay: forecast.lastFundedDay,
      shortByDays: Math.max(0, cycle.length - forecast.lastFundedDay),
      likelyRangeDays: [forecast.mc.p10, forecast.mc.p90],
      chanceOfRunningOut: Math.round(forecast.mc.probRunout * 100) + "%",
    },
    thisCycleByCategory: a.pace.filter((p) => p.now > 0 || p.usual).map((p) => ({ category: p.label, spent: Math.round(p.now), usualByThisDay: p.usual == null ? null : Math.round(p.usual), orders: p.count })),
    goals: a.goals.map((g) => ({ name: g.name, saved: g.saved, target: g.target, deadline: g.deadline, perWeekNeeded: g.perWeek })),
    alerts: a.alerts.map((x) => x.title),
  });
}

/** Page tools Claude may call. Results are small plain objects. */
export function claudeTools(a, txns) {
  const catIds = CATEGORIES.map((c) => c.id);
  return [
    {
      name: "simulate_purchase",
      description: "Simulate spending an extra amount today. Returns the new last funded day of the cycle, days short, and the new safe-to-spend per day.",
      inputSchema: { type: "object", properties: { amount_inr: { type: "number", description: "Amount in rupees" } }, required: ["amount_inr"] },
      execute: (input) => {
        const amt = Math.max(0, Number(input.amount_inr) || 0);
        const res = a.levers.purchase(amt);
        const newSafe = safeToSpend({ startBalance: a.startBalance - amt, bills: a.bills, cycle: a.cycle, buffer: a.safe.buffer, spentToday: a.spentToday }).daily;
        return { amount: amt, lastFundedDayBefore: a.forecast.lastFundedDay, lastFundedDayAfter: res.lastFundedDay, cycleLength: a.cycle.length, safePerDayBefore: a.safe.daily, safePerDayAfter: newSafe };
      },
    },
    {
      name: "simulate_cut",
      description: "Simulate skipping a number of orders/purchases in a category for the rest of this cycle (each skip saves that category's typical spend). Returns the new last funded day.",
      inputSchema: {
        type: "object",
        properties: { category: { type: "string", enum: catIds }, count: { type: "number", description: "How many orders or purchases to skip" } },
        required: ["category", "count"],
      },
      execute: (input) => {
        const cat = String(input.category);
        const k = Math.max(0, Math.min(60, Math.round(Number(input.count) || 0)));
        const row = a.pace.find((p) => p.id === cat);
        if (!row) throw new Error(`Unknown category ${cat}`);
        const saving = k * (row.avgOrder || 0);
        const res = a.levers.save(saving);
        return { category: row.label, skipped: k, typicalSpend: Math.round(row.avgOrder), saving: Math.round(saving), lastFundedDayBefore: a.forecast.lastFundedDay, lastFundedDayAfter: res.lastFundedDay, cycleLength: a.cycle.length };
      },
    },
    {
      name: "spend_by_category",
      description: "Total spending by category over the last N days (N up to 120). Returns rows of {category, amount}.",
      inputSchema: { type: "object", properties: { days: { type: "number" } }, required: ["days"] },
      execute: (input) => {
        const n = Math.max(1, Math.min(120, Math.round(Number(input.days) || 7)));
        const { total, rows } = spendSince(txns, addDays(a.asOf, -(n - 1)), a.asOf);
        return { days: n, total: Math.round(total), rows: rows.map(([c, v]) => ({ category: catLabel(c), amount: Math.round(v) })) };
      },
    },
    {
      name: "list_transactions",
      description: "Recent transactions, newest first, optionally filtered by category and number of days. Returns at most 25 rows of {date, merchant, amount, category, direction}.",
      inputSchema: { type: "object", properties: { category: { type: "string", enum: [...catIds, "income"] }, days: { type: "number" }, limit: { type: "number" } } },
      execute: (input) => {
        const n = Math.max(1, Math.min(120, Math.round(Number(input.days) || 14)));
        const lim = Math.max(1, Math.min(25, Math.round(Number(input.limit) || 15)));
        const from = addDays(a.asOf, -(n - 1));
        return txns
          .filter((t) => t.date >= from && t.date <= a.asOf && (!input.category || t.category === input.category))
          .slice(-lim)
          .reverse()
          .map((t) => ({ date: t.date, merchant: t.merchant, amount: t.amount, category: catLabel(t.category), direction: t.direction }));
      },
    },
  ];
}

/** Ask Claude to tag spends the rules and model were unsure about. */
export function tagPrompt(items) {
  const cats = CATEGORIES.map((c) => `${c.id} (${c.label})`).join(", ");
  return `Categorise these Indian UPI/bank transactions from a student's statement. Categories: ${cats}.
A payment to a person's name is friends. Reply with only a JSON array of {"id": string, "category": string} using the category ids exactly.
${JSON.stringify(items.map((t) => ({ id: t.id, payee: t.merchant, details: t.text, amount: t.amount })))}`;
}

export { diffDays };
