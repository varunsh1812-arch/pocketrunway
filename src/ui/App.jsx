import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  analyze, categoriseAll, trainModel, teach, evaluateModel, parseStatement, generateDemo, DEMO,
  rupees, shortDate, addDays, pct, CATEGORIES, catLabel, localAnswer, RULES, contextJSON, claudeTools, tagPrompt, diffDays,
} from "../engine/index.js";
import { Icon, Sheet, Alert, RunwayChart, CategoryBars, WeekdayBars, initials } from "./parts.jsx";
import { getSample, PERMANENT, errorCopy } from "./claude.js";

const STORE = "pocketrunway:v1";
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "null");
  } catch {
    return null;
  }
};
const save = (s) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* private mode or blocked storage: the app still works for this visit */
  }
};

const DEFAULTS = {
  source: "demo",
  csv: null,
  settings: { name: DEMO.name, incomeDay: DEMO.incomeDay, buffer: 500, currentBalance: null },
  goals: DEMO.goals,
  overrides: {},
  manual: {},
  aiTags: {},
};

function reducer(s, a) {
  switch (a.type) {
    case "set":
      return { ...s, ...a.patch };
    case "settings":
      return { ...s, settings: { ...s.settings, ...a.patch } };
    case "recat": {
      const { txn, cat, all } = a;
      if (all) return { ...s, overrides: { ...s.overrides, [txn.merchantKey]: cat }, manual: { ...s.manual, [txn.id]: undefined } };
      return { ...s, manual: { ...s.manual, [txn.id]: cat } };
    }
    case "aiTags":
      return { ...s, aiTags: { ...s.aiTags, ...a.tags } };
    case "goal": {
      const goals = s.goals.map((g) => (g.id === a.id ? { ...g, ...a.patch } : g));
      return { ...s, goals };
    }
    case "addGoal":
      return { ...s, goals: [...s.goals, a.goal] };
    case "removeGoal":
      return { ...s, goals: s.goals.filter((g) => g.id !== a.id) };
    case "reset":
      return { ...DEFAULTS };
    default:
      return s;
  }
}

const TABS = [
  ["today", "Today", "home"],
  ["spends", "Spends", "list"],
  ["forecast", "Forecast", "chart"],
  ["goals", "Goals", "target"],
  ["ask", "Ask", "chat"],
];

export default function App() {
  const [state, dispatch] = useReducer(reducer, null, () => ({ ...DEFAULTS, ...(load() || {}) }));
  const [tab, setTab] = useState(() => (["today", "spends", "forecast", "goals", "ask"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "today"));
  const [sheet, setSheet] = useState(null); // {kind, ...}
  const [toast, setToast] = useState(null);
  const [chat, setChat] = useState([]);
  const [claude, setClaude] = useState({ status: "checking", sample: null, tools: false });
  const screenRef = useRef(null);

  useEffect(() => {
    save({ source: state.source, csv: state.csv, settings: state.settings, goals: state.goals, overrides: state.overrides, manual: state.manual, aiTags: state.aiTags });
  }, [state]);
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1);
      if (TABS.some(([k]) => k === h)) setTab(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    let alive = true;
    getSample().then(async (sample) => {
      if (!alive) return;
      if (!sample) return setClaude({ status: "off", sample: null, tools: false });
      const limits = await sample.limits().catch(() => null);
      setClaude({ status: "ready", sample, tools: !!limits?.tools });
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const go = (k) => {
    setTab(k);
    try {
      history.replaceState(null, "", `#${k}`);
    } catch {
      /* ignore */
    }
    screenRef.current?.scrollTo?.({ top: 0 });
  };

  // ---------- data pipeline ----------
  const demo = useMemo(() => generateDemo(), []);
  const parsed = useMemo(() => {
    try {
      return { ...parseStatement(state.source === "import" && state.csv ? state.csv : demo.csv), error: null };
    } catch (e) {
      return { ...parseStatement(demo.csv), error: e.message };
    }
  }, [state.source, state.csv, demo]);
  const evalScores = useMemo(() => evaluateModel(trainModel()), []);
  const model = useMemo(() => {
    const m = trainModel();
    for (const [key, cat] of Object.entries(state.overrides)) {
      const t = parsed.transactions.find((x) => x.merchantKey === key);
      if (t) teach(m, t, cat);
    }
    return m;
  }, [state.overrides, parsed]);
  const txns = useMemo(() => {
    const base = categoriseAll(parsed.transactions, model, state.overrides, state.aiTags);
    return base.map((t) => (state.manual[t.id] ? { ...t, category: state.manual[t.id], confidence: 1, source: "you", unsure: false } : t));
  }, [parsed, model, state.overrides, state.aiTags, state.manual]);
  const isDemo = state.source !== "import";
  const asOf = isDemo ? DEMO.asOf : parsed.transactions[parsed.transactions.length - 1]?.date;
  const a = useMemo(
    () =>
      analyze({
        txns,
        settings: { ...state.settings, currentBalance: parsed.closingBalance ?? state.settings.currentBalance },
        goals: state.goals,
        asOf,
      }),
    [txns, state.settings, state.goals, asOf, parsed.closingBalance],
  );

  // ---------- assistant ----------
  const ctlRef = useRef(null);
  const ask = async (question) => {
    const q = question.trim();
    if (!q) return;
    go("ask");
    const history = chat.filter((m) => !m.pending);
    const local = localAnswer(q, a, txns);
    if (claude.status !== "ready") {
      setChat([...history, { role: "user", text: q }, { role: "bot", text: local.text, by: "device" }]);
      return;
    }
    setChat([...history, { role: "user", text: q }, { role: "bot", text: "", by: "claude", pending: true }]);
    const turns = [{ role: "user", content: `${RULES}\n\nDATA (computed by the app for ${shortDate(a.asOf)}):\n${contextJSON(a)}` }];
    for (const m of history.slice(-6)) if (m.text) turns.push({ role: m.role === "user" ? "user" : "assistant", content: m.text });
    turns.push({ role: "user", content: q });
    const ctl = new AbortController();
    ctlRef.current = ctl;
    const update = (text, extra = {}) =>
      setChat((c) => {
        const next = [...c];
        next[next.length - 1] = { ...next[next.length - 1], text, ...extra };
        return next;
      });
    try {
      const opts = { signal: ctl.signal, modelTier: "quick", onText: ({ text }) => update(text) };
      if (claude.tools) opts.tools = claudeTools(a, txns);
      else opts.cache = false;
      const { text } = await claude.sample(turns, opts);
      update(text, { pending: false });
    } catch (e) {
      const code = e?.code;
      if (code === "cancelled") return update(e.text || "Stopped.", { pending: false });
      if (PERMANENT.has(code)) setClaude((c) => ({ ...c, status: "off" }));
      update(`${local.text}\n\n${errorCopy(code)}`, { pending: false, by: "device" });
    } finally {
      ctlRef.current = null;
    }
  };
  const stop = () => ctlRef.current?.abort();

  // ---------- AI tagging ----------
  const [tagging, setTagging] = useState(false);
  const unsure = txns.filter((t) => t.unsure && t.direction === "debit");
  const tagWithClaude = async () => {
    if (claude.status !== "ready" || !unsure.length) return;
    setTagging(true);
    try {
      const items = unsure.slice(0, 40);
      const res = await claude.sample.json(tagPrompt(items), { modelTier: "quick" });
      const valid = new Set(CATEGORIES.map((c) => c.id));
      const tags = {};
      for (const r of Array.isArray(res) ? res : []) if (r && valid.has(r.category) && items.some((t) => t.id === r.id)) tags[r.id] = r.category;
      dispatch({ type: "aiTags", tags });
      setToast(Object.keys(tags).length ? `Claude tagged ${Object.keys(tags).length} spend${Object.keys(tags).length > 1 ? "s" : ""}. Tap any to change it.` : "Claude couldn't place those. Tag them yourself.");
    } catch (e) {
      if (PERMANENT.has(e?.code)) setClaude((c) => ({ ...c, status: "off" }));
      setToast(e?.code === "rate_limited" ? "Claude is busy. Try again in a bit." : "Claude couldn't tag them this time.");
    } finally {
      setTagging(false);
    }
  };

  const name = state.settings.name || "there";
  const screen = {
    today: <Today a={a} name={name} onAsk={ask} go={go} />,
    spends: <Spends a={a} txns={txns} unsure={unsure} claude={claude} tagging={tagging} onTag={tagWithClaude} onPick={(t) => setSheet({ kind: "cat", txn: t })} />,
    forecast: <Forecast a={a} evalScores={evalScores} />,
    goals: <Goals a={a} dispatch={dispatch} setToast={setToast} />,
    ask: <Ask a={a} chat={chat} claude={claude} onAsk={ask} onStop={stop} onClear={() => setChat([])} />,
  }[tab];

  return (
    <div className="page">
      <Story a={a} evalScores={evalScores} isDemo={isDemo} />
      <div className="app">
        <header className="topbar">
          <div>
            <div className="brand">
              Pocket<em>Runway</em>
            </div>
            <div className="greet">{`Hi ${name} · Day ${a.cycle.dayIndex} of ${a.cycle.length}`}</div>
          </div>
          <div className="spacer" />
          <span className={`pill ${isDemo ? "gold" : ""}`}>{isDemo ? "Demo data" : "Your statement"}</span>
          <button className="iconbtn mobile-only" onClick={() => setSheet({ kind: "about" })} aria-label="About PocketRunway">
            <Icon name="info" size={18} />
          </button>
          <button className="iconbtn" onClick={() => setSheet({ kind: "data" })} aria-label="Data and settings">
            <Icon name="data" size={18} />
          </button>
        </header>
        <main className="screen" ref={screenRef} id={`screen-${tab}`}>
          {screen}
        </main>
        <nav className="tabs" aria-label="Sections">
          {TABS.map(([k, label, icon]) => (
            <button key={k} className="tab" aria-current={tab === k ? "page" : undefined} onClick={() => go(k)}>
              <Icon name={icon} size={21} />
              {label}
            </button>
          ))}
        </nav>
        {sheet?.kind === "cat" && (
          <CategorySheet
            txn={sheet.txn}
            onClose={() => setSheet(null)}
            onSave={(cat, all) => {
              dispatch({ type: "recat", txn: sheet.txn, cat, all });
              setSheet(null);
              setToast(all ? `All ${sheet.txn.merchant} spends are now ${catLabel(cat)}. The model learned it.` : `Changed to ${catLabel(cat)}.`);
            }}
          />
        )}
        {sheet?.kind === "data" && (
          <DataSheet
            state={state}
            parsed={parsed}
            demoCsv={demo.csv}
            dispatch={dispatch}
            onClose={() => setSheet(null)}
            setToast={setToast}
            go={go}
          />
        )}
        {sheet?.kind === "about" && (
          <Sheet title="About" onClose={() => setSheet(null)}>
            <StoryBody a={a} evalScores={evalScores} isDemo={isDemo} />
          </Sheet>
        )}
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Story(props) {
  return (
    <aside className="story" aria-label="About PocketRunway">
      <div className="kicker">Group 8 · Innovation &amp; Entrepreneurship · Assignment 2</div>
      <h1>POCKETRUNWAY</h1>
      <StoryBody {...props} />
    </aside>
  );
}

function StoryBody({ a, evalScores, isDemo }) {
  const bt = a.backtest;
  return (
    <div>
      <p className="tagline">Know if your money will last the month, before it runs out.</p>
      <div className="rule" />
      <p className="lede">
        An AI-powered finance app for students and first-time earners. It reads your spending, forecasts the day your money runs out, and gives you one daily
        number: what you can safely spend today.
      </p>
      <div className="label" style={{ marginBottom: 8 }}>
        What the AI does, measured
      </div>
      <div className="ai-cards">
        <div className="ai-card">
          <div className="ic">
            <Icon name="tag" />
          </div>
          <div>
            <b>Categorises spends</b>
            <span>Brand rules plus a Naive Bayes model on payee names</span>
          </div>
          <div className="metric num">
            {pct(evalScores.accuracy)}
            <small>{`on ${evalScores.nTest} unseen payees`}</small>
          </div>
        </div>
        <div className="ai-card">
          <div className="ic">
            <Icon name="chart" />
          </div>
          <div>
            <b>Forecasts month-end</b>
            <span>Pace model with Monte Carlo range</span>
          </div>
          <div className="metric num">
            {bt.maeModel != null ? `±${bt.maeModel.toFixed(1)}d` : "n/a"}
            <small>{bt.maeNaive != null ? `vs ±${bt.maeNaive.toFixed(1)}d naive, ${bt.cases.length} months` : "needs 2+ months"}</small>
          </div>
        </div>
        <div className="ai-card">
          <div className="ic">
            <Icon name="spark" />
          </div>
          <div>
            <b>Explains in plain words</b>
            <span>Claude with 4 app tools, on-device fallback</span>
          </div>
          <div className="metric">
            Ask
            <small>“Why am I low?”</small>
          </div>
        </div>
      </div>
      <div className="foot">
        <p>{isDemo ? "Riya is a fictional persona. Her statement is synthetic: 5 months of student UPI spends generated for this demo." : "You're viewing your own statement. It stays in this browser."}</p>
        <p>Budgeting help only, not investment advice. Statements never leave the browser; the assistant sends Claude a summary only when you ask a question.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Today({ a, name, onAsk, go }) {
  const { safe, cycle, forecast } = a;
  const [skips, setSkips] = useState(4);
  const fundedPct = (Math.min(forecast.lastFundedDay, cycle.length) / cycle.length) * 100;
  const todayPct = ((cycle.dayIndex - 0.5) / cycle.length) * 100;
  const shortBy = cycle.length - forecast.lastFundedDay;
  const skipDay = a.levers.skip(skips);
  const goal = a.goals[0];
  const used = safe.daily > 0 ? Math.min(1, safe.spentToday / safe.daily) : 1;
  const others = a.alerts.filter((x) => x.id !== "runway");
  return (
    <>
      <section className="card hero" aria-labelledby="safe-h">
        <div className="label" id="safe-h">
          Safe to spend today
        </div>
        <div className="big num">{rupees(safe.daily)}</div>
        <div className="meter" aria-hidden="true">
          <i style={{ width: `${used * 100}%`, background: safe.leftToday < 0 ? "var(--crit)" : undefined }} />
        </div>
        <p className="sub" style={{ marginTop: 8 }}>
          {safe.daily > 0
            ? `${rupees(safe.spentToday)} spent · ${safe.leftToday >= 0 ? `${rupees(safe.leftToday)} left today` : `${rupees(-safe.leftToday)} over`}`
            : "Nothing spare today. Essentials only until your allowance."}
        </p>
        <p className="note" style={{ marginTop: 6 }}>{`Keeps ${rupees(safe.buffer)} spare and sets aside ${rupees(safe.billTotal)} for bills.`}</p>
      </section>

      <section className="card" aria-labelledby="runway-h">
        <div className="row between">
          <div className="label" id="runway-h">
            Your money lasts until
          </div>
          <span className="pill">{`Next allowance ${shortDate(cycle.next)}`}</span>
        </div>
        <div className="row" style={{ alignItems: "baseline", gap: 8, marginTop: 4 }}>
          <span className="h2" style={{ fontSize: 34 }}>{forecast.lastFundedDay >= cycle.length ? `Day ${cycle.length}` : `Day ${forecast.lastFundedDay}`}</span>
          <span className="muted">{`of ${cycle.length}`}</span>
        </div>
        <div className="runway" role="img" aria-label={`Funded until day ${forecast.lastFundedDay} of ${cycle.length}. Today is day ${cycle.dayIndex}.`}>
          <div className="fund" style={{ width: `${fundedPct}%` }} />
          <div className="today" style={{ left: `${todayPct}%` }} />
        </div>
        <div className="runway-scale num">
          <span style={{ left: 0 }}>Day 1</span>
          {shortBy > 0 && shortBy < cycle.length - 3 && (
            <span style={{ left: `${fundedPct}%` }}>
              <b>{`Day ${forecast.lastFundedDay}`}</b>
            </span>
          )}
          <span style={{ left: "100%" }}>{`Day ${cycle.length}`}</span>
        </div>
        <div className={`status ${shortBy > 0 ? "crit" : "good"}`}>
          <Icon name={shortBy > 0 ? "alert" : "check"} size={18} />
          <span>{shortBy > 0 ? `Short by ${shortBy} day${shortBy > 1 ? "s" : ""} at the current pace` : "On track to your next allowance"}</span>
        </div>
        <p className="note" style={{ marginTop: 4 }}>
          {`Likely Day ${forecast.mc.p10}–${Math.min(cycle.length, forecast.mc.p90)} · ${pct(forecast.mc.probRunout)} chance of running short · you average ${rupees(forecast.level)} a day`}
        </p>
      </section>

      {shortBy > 0 && (
        <section className="card" aria-labelledby="fix-h">
          <div className="label" id="fix-h">
            Fix it
          </div>
          <div className="row between" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div className="h3">Skip food orders</div>
              <p className="sub">{`About ${rupees(a.levers.order)} saved each`}</p>
            </div>
            <div className="stepper" role="group" aria-label="Orders to skip">
              <button onClick={() => setSkips((k) => Math.max(0, k - 1))} aria-label="Skip one fewer">
                −
              </button>
              <output aria-live="polite">{skips}</output>
              <button onClick={() => setSkips((k) => Math.min(20, k + 1))} aria-label="Skip one more">
                +
              </button>
            </div>
          </div>
          <p className="status" style={{ marginTop: 8 }}>
            <Icon name="bolt" size={18} className="gold" />
            <span>{skipDay >= cycle.length ? `Lasts to Day ${cycle.length}. You make it.` : `Lasts to Day ${skipDay} (${skipDay - forecast.lastFundedDay >= 0 ? "+" : ""}${skipDay - forecast.lastFundedDay} days)`}</span>
          </p>
          <p className="sub" style={{ marginTop: 6 }}>{`Or hold to ${rupees(safe.daily)} a day and you reach Day ${cycle.length} with ${rupees(safe.buffer)} to spare.`}</p>
        </section>
      )}

      {others.length > 0 && (
        <section className="stack" aria-label="Insights">
          {others.map((x) => (
            <Alert key={x.id} a={x} />
          ))}
        </section>
      )}

      {goal && (
        <button className="card goal" style={{ textAlign: "left", border: 0 }} onClick={() => go("goals")}>
          <div className="row between">
            <div className="h3">{goal.name}</div>
            <span className="muted num">{`${rupees(goal.saved)} of ${rupees(goal.target)}`}</span>
          </div>
          <div className="bar">
            <i style={{ width: `${goal.progress * 100}%` }} />
          </div>
          <p className="sub">{`${rupees(goal.perWeek)} a week reaches it by ${shortDate(goal.deadline)}.`}</p>
        </button>
      )}

      <section aria-label="Ask PocketRunway">
        <div className="label" style={{ marginBottom: 8 }}>
          Ask
        </div>
        <div className="chips">
          {["Why am I low?", "Can I afford a ₹1,200 concert ticket?", "How much can I spend this weekend?"].map((q) => (
            <button key={q} className="chip" onClick={() => onAsk(q)}>
              {q}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
const SRC = { rule: "Rule", model: "Model", ai: "Claude", you: "You" };
function Spends({ a, txns, unsure, claude, tagging, onTag, onPick }) {
  const [filter, setFilter] = useState(null);
  const [all, setAll] = useState(false);
  const [limit, setLimit] = useState(80);
  const from = all ? "0000" : a.cycle.start;
  const rows = txns
    .filter((t) => t.date >= from && t.date <= a.asOf)
    .filter((t) => !filter || (filter === "unsure" ? t.unsure : t.category === filter))
    .slice()
    .reverse();
  const groups = [];
  for (const t of rows.slice(0, limit)) {
    const g = groups[groups.length - 1];
    if (g && g.date === t.date) g.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }
  const present = new Set(txns.filter((t) => t.date >= from).map((t) => t.category));
  return (
    <>
      <section className="card">
        <div className="row between">
          <div className="label">This month so far</div>
          <span className="pill">{`Day ${a.cycle.dayIndex} of ${a.cycle.length}`}</span>
        </div>
        <div className="row" style={{ gap: 18, margin: "8px 0 14px" }}>
          <div>
            <div className="h2 num">{rupees(a.spentThisCycle)}</div>
            <span className="note">spent</span>
          </div>
          <div>
            <div className="h2 num good">{rupees(a.inThisCycle)}</div>
            <span className="note">came in</span>
          </div>
        </div>
        <CategoryBars pace={a.pace} dayIndex={a.cycle.dayIndex} active={filter} onPick={(id) => setFilter((f) => (f === id ? null : id))} />
      </section>

      {unsure.length > 0 && (
        <section className="card" style={{ borderLeft: "3px solid var(--warn)" }}>
          <div className="row between" style={{ alignItems: "flex-start", gap: 12 }}>
            <div>
              <div className="h3">{`${unsure.length} spend${unsure.length > 1 ? "s" : ""} need a second look`}</div>
              <p className="sub">The model hasn't seen these payees before, so they're held out of your categories.</p>
            </div>
          </div>
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
            {claude.status === "ready" && (
              <button className="btn primary small" onClick={onTag} disabled={tagging}>
                <Icon name="spark" size={16} />
                {tagging ? "Asking Claude…" : "Tag with Claude"}
              </button>
            )}
            <button className="btn small" onClick={() => setFilter("unsure")}>
              Review them
            </button>
          </div>
          {claude.status !== "ready" && <p className="note" style={{ marginTop: 8 }}>Inside the Claude app, Claude can tag these for you.</p>}
        </section>
      )}

      <div className="chips" role="group" aria-label="Filter by category">
        <button className="chip" aria-pressed={!filter} onClick={() => setFilter(null)}>
          All
        </button>
        {unsure.length > 0 && (
          <button className="chip" aria-pressed={filter === "unsure"} onClick={() => setFilter("unsure")}>
            Needs a look
          </button>
        )}
        {CATEGORIES.filter((c) => present.has(c.id)).map((c) => (
          <button key={c.id} className="chip" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
            {c.short}
          </button>
        ))}
        {present.has("income") && (
          <button className="chip" aria-pressed={filter === "income"} onClick={() => setFilter("income")}>
            Money in
          </button>
        )}
      </div>

      <section className="card" style={{ paddingTop: 6, paddingBottom: 6 }} aria-label="Transactions">
        {groups.length === 0 && <p className="sub" style={{ padding: "12px 0" }}>No transactions match this filter.</p>}
        {groups.map((g) => {
          const out = g.items.filter((t) => t.direction === "debit").reduce((s, t) => s + t.amount, 0);
          return (
            <div className="daygroup" key={g.date}>
              <div className="dayhead">
                <span>{`${shortDate(g.date)} · Day ${diffDays(g.date, a.cycle.start) + 1 > 0 && g.date >= a.cycle.start ? diffDays(g.date, a.cycle.start) + 1 : "–"}`}</span>
                <span className="num">{out ? `−${rupees(out)}` : ""}</span>
              </div>
              {g.items.map((t) => (
                <div className="tx" key={t.id}>
                  <div className="av" aria-hidden="true">
                    {initials(t.merchant)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="m">{t.merchant}</div>
                    <div className="meta">
                      {t.direction === "debit" ? (
                        <button className="catbtn" data-low={t.unsure ? "true" : "false"} onClick={() => onPick(t)} aria-label={`Category ${t.unsure ? "not sure" : catLabel(t.category)}. Change`}>
                          {t.unsure ? "Not sure yet" : catLabel(t.category)}
                        </button>
                      ) : (
                        <span className="catbtn" style={{ color: "var(--good)" }}>
                          Money in
                        </span>
                      )}
                      <span className="src">{t.direction === "debit" ? `${SRC[t.source]}${t.source === "model" && !t.unsure ? ` ${pct(t.confidence)}` : ""}` : t.channel}</span>
                    </div>
                  </div>
                  <div className={`amt ${t.direction === "credit" ? "in" : ""}`}>{`${t.direction === "credit" ? "+" : "−"}${rupees(t.amount)}`}</div>
                </div>
              ))}
            </div>
          );
        })}
      </section>
      <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        {rows.length > limit && (
          <button className="btn small" onClick={() => setLimit((l) => l + 120)}>
            Show more
          </button>
        )}
        <button className="btn small ghost" onClick={() => setAll((v) => !v)}>
          {all ? "Only this month" : "Show earlier months"}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function Forecast({ a, evalScores }) {
  const { forecast, cycle, safe, backtest: bt } = a;
  const m = forecast.model;
  return (
    <>
      <section className="card">
        <div className="row between">
          <div className="label">Balance this month</div>
          <span className="pill">{`${shortDate(cycle.start)} – ${shortDate(cycle.end)}`}</span>
        </div>
        <div style={{ marginTop: 10 }}>
          <RunwayChart a={a} />
        </div>
      </section>
      <div className="stat3">
        <div>
          <b className="num">{rupees(forecast.level)}</b>
          <span>your daily pace</span>
        </div>
        <div>
          <b className="num gold">{rupees(safe.daily)}</b>
          <span>safe daily pace</span>
        </div>
        <div>
          <b className={`num ${forecast.mc.probRunout > 0.5 ? "crit" : "good"}`}>{pct(forecast.mc.probRunout)}</b>
          <span>chance of running short</span>
        </div>
      </div>

      {a.bills.length > 0 && (
        <section className="card">
          <div className="label">Bills still to come</div>
          <dl className="kv" style={{ marginTop: 10 }}>
            {a.bills.map((b) => (
              <React.Fragment key={b.key}>
                <dt>{`${b.merchant} · ~${shortDate(b.date)}`}</dt>
                <dd>{rupees(b.amount)}</dd>
              </React.Fragment>
            ))}
          </dl>
          <p className="note" style={{ marginTop: 8 }}>Spotted automatically: same payee, similar amount, same time each month.</p>
        </section>
      )}

      <section className="card stack" aria-labelledby="how-h">
        <div className="label" id="how-h">
          How the forecast works
        </div>
        <p className="sub">
          {`Your everyday pace blends this month (${pct(m.mtdWeight)} weight, ${rupees(m.levelMtd ?? 0)}/day) with your history (${pct(1 - m.mtdWeight)}, ${rupees(m.levelHist ?? 0)}/day). Days when you'd already run out are left out, so "making do" isn't mistaken for normal. Bills are scheduled on their own.`}
        </p>
        <div>
          <div className="note" style={{ marginBottom: 6 }}>
            Your spending by weekday (vs your average)
          </div>
          <WeekdayBars mult={m.mult} />
        </div>
        <p className="sub">{`1,500 simulated months, each built from real days of yours, give the likely range: Day ${forecast.mc.p10} to Day ${Math.min(cycle.length, forecast.mc.p90)}.`}</p>
      </section>

      <section className="card stack" aria-labelledby="test-h">
        <div className="label" id="test-h">
          Tested on your past months
        </div>
        {bt.cases.length ? (
          <>
            <p className="sub">{`Standing on Day ${bt.checkDay} of each past month, using only data up to then. Off by ${bt.maeModel.toFixed(1)} days on average, vs ${bt.maeNaive.toFixed(1)} for a simple "spent so far" rule.`}</p>
            <div style={{ overflowX: "auto" }}>
              <table className="num" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr className="muted" style={{ textAlign: "right" }}>
                    <th style={{ textAlign: "left", fontWeight: 600, padding: "4px 0" }}>Month</th>
                    <th style={{ fontWeight: 600 }}>Model</th>
                    <th style={{ fontWeight: 600 }}>Simple rule</th>
                    <th style={{ fontWeight: 600 }}>Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {bt.cases.map((c) => (
                    <tr key={c.cycleStart} style={{ textAlign: "right", borderTop: "1px solid var(--line)" }}>
                      <td style={{ textAlign: "left", padding: "6px 0" }}>{shortDate(c.cycleStart).split(" ")[1]}</td>
                      <td>{`Day ${c.predicted}`}</td>
                      <td className="muted">{`Day ${c.naive}`}</td>
                      <td>{`Day ${c.actual}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="sub">Needs at least two full months of history to backtest.</p>
        )}
      </section>

      <section className="card stack" aria-labelledby="cat-h">
        <div className="label" id="cat-h">
          How categories are tagged
        </div>
        <p className="sub">{`Known brands (Swiggy, Blinkit, Rapido…) and telling words ("canteen", "xerox", "medical") are matched by rules. Everything else goes to a Naive Bayes model trained on payee names. On ${evalScores.nTest} payees it never saw, the full pipeline gets ${pct(evalScores.accuracy)} right (macro-F1 ${evalScores.macroF1.toFixed(2)}). Payees it can't place are held for you or Claude, and every correction retrains it on the spot.`}</p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
function Goals({ a, dispatch, setToast }) {
  const [form, setForm] = useState({ name: "", target: "", deadline: addDays(a.asOf, 90) });
  const short = a.cycle.length - a.forecast.lastFundedDay;
  return (
    <>
      {a.goals.map((g) => (
        <section className="card goal" key={g.id}>
          <div className="row between">
            <div className="h3">{g.name}</div>
            <span className="pill">{`by ${shortDate(g.deadline)}`}</span>
          </div>
          <div className="bar">
            <i style={{ width: `${g.progress * 100}%` }} />
          </div>
          <div className="row between">
            <span className="num">
              <b>{rupees(g.saved)}</b>
              <span className="muted">{` of ${rupees(g.target)}`}</span>
            </span>
            <span className="muted">{pct(g.progress)}</span>
          </div>
          <p className="sub" style={{ marginTop: 8 }}>{g.done ? "Done. Enjoy it." : `${rupees(g.perWeek)} a week for ${g.weeksLeft} weeks gets you there.`}</p>
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
            {[100, 500].map((v) => (
              <button
                key={v}
                className="btn small"
                onClick={() => {
                  dispatch({ type: "goal", id: g.id, patch: { saved: Math.min(g.target, g.saved + v) } });
                  setToast(`Added ${rupees(v)} to ${g.name}.`);
                }}
              >
                <Icon name="plus" size={14} />
                {rupees(v)}
              </button>
            ))}
            <button className="btn small ghost" onClick={() => dispatch({ type: "removeGoal", id: g.id })}>
              Remove
            </button>
          </div>
        </section>
      ))}
      {short > 0 && a.goals.length > 0 && <Alert a={{ severity: "info", title: "Fix the runway first", body: `You're ${short} days short this month, so start goal transfers after your allowance on ${shortDate(a.cycle.next)}.` }} />}
      <section className="card">
        <div className="label">New goal</div>
        <form
          className="stack"
          style={{ marginTop: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            const target = Math.round(Number(form.target));
            if (!form.name.trim() || !(target > 0)) return setToast("Add a name and a target amount.");
            dispatch({ type: "addGoal", goal: { id: `g${Date.now()}`, name: form.name.trim(), target, saved: 0, deadline: form.deadline } });
            setForm({ name: "", target: "", deadline: addDays(a.asOf, 90) });
            setToast("Goal added.");
          }}
        >
          <label className="field" htmlFor="goal-name">
            What for
            <input id="goal-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="New phone, fest pass, trip home" />
          </label>
          <div className="grid2">
            <label className="field" htmlFor="goal-target">
              Target (₹)
              <input id="goal-target" inputMode="numeric" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value.replace(/[^0-9]/g, "") })} placeholder="3000" />
            </label>
            <label className="field" htmlFor="goal-date">
              By
              <input id="goal-date" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </label>
          </div>
          <button className="btn primary" type="submit">
            Add goal
          </button>
        </form>
        <p className="note" style={{ marginTop: 10 }}>Goals and alerts are plain rules, not AI. That's deliberate.</p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
const SUGGEST = ["Why am I low?", "Can I afford a ₹1,200 concert ticket?", "What if I skip 4 Swiggy orders?", "Where did my money go this week?", "How much can I spend this weekend?", "How do I reach my Goa trip goal?"];
function Ask({ a, chat, claude, onAsk, onStop, onClear }) {
  const [text, setText] = useState("");
  const endRef = useRef(null);
  useEffect(() => {
    // scroll methods return a Promise in newer browsers; never hand that to React
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat]);
  const busy = chat.some((m) => m.pending);
  return (
    <>
      <section className="card">
        <div className="row between">
          <div className="label">Ask PocketRunway</div>
          <span className={`pill ${claude.status === "ready" ? "gold" : ""}`}>{claude.status === "ready" ? "Claude" : claude.status === "checking" ? "Connecting…" : "On-device"}</span>
        </div>
        <p className="sub" style={{ marginTop: 6 }}>
          {claude.status === "ready"
            ? "Claude answers with your numbers and can run what-ifs with the app's tools. The first question asks your permission."
            : "Answers come from the on-device engine using your numbers. Inside the Claude app, Claude answers instead."}
        </p>
      </section>
      <div className="chat" aria-live="polite">
        {chat.length === 0 && (
          <div className="bubble bot">
            {`Hi! It's Day ${a.cycle.dayIndex}. Ask me anything about your money this month.`}
            <span className="by">PocketRunway</span>
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className={`bubble ${m.role === "user" ? "me" : "bot"}`}>
            {m.pending && !m.text ? (
              <span className="thinking" aria-label="Thinking">
                <i />
                <i />
                <i />
              </span>
            ) : (
              m.text
            )}
            {m.role !== "user" && !m.pending && <span className="by">{m.by === "claude" ? "Claude · from your numbers" : "On-device engine"}</span>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="chips">
        {SUGGEST.map((q) => (
          <button key={q} className="chip" disabled={busy} onClick={() => onAsk(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          onAsk(text);
          setText("");
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <input id="ask-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Can I afford ₹800 shoes?" autoComplete="off" />
        {busy ? (
          <button type="button" className="btn" onClick={onStop} aria-label="Stop">
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button type="submit" className="btn primary" aria-label="Send" disabled={!text.trim()}>
            <Icon name="send" size={16} />
          </button>
        )}
      </form>
      {chat.length > 0 && (
        <button className="btn small ghost" style={{ alignSelf: "center" }} onClick={onClear}>
          Clear chat
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function CategorySheet({ txn, onClose, onSave }) {
  const [cat, setCat] = useState(txn.unsure ? null : txn.category);
  const [all, setAll] = useState(true);
  return (
    <Sheet title="Category" onClose={onClose}>
      <div className="card" style={{ background: "var(--card)" }}>
        <div className="row between">
          <b>{txn.merchant}</b>
          <span className="num">{rupees(txn.amount)}</span>
        </div>
        <p className="note" style={{ marginTop: 4, overflowWrap: "anywhere" }}>{`${shortDate(txn.date)} · ${txn.narration}`}</p>
      </div>
      <div className="catlist">
        {CATEGORIES.map((c) => (
          <button key={c.id} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <label className="toggle" htmlFor="cat-all">
        <input id="cat-all" type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        {`Always use this for ${txn.merchant}`}
      </label>
      <button className="btn primary" disabled={!cat} onClick={() => onSave(cat, all)}>
        Save
      </button>
    </Sheet>
  );
}

function DataSheet({ state, parsed, demoCsv, dispatch, onClose, setToast, go }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const s = state.settings;
  const tryParse = (csv) => {
    try {
      const res = parseStatement(csv);
      setPreview({ csv, res });
      setError(null);
    } catch (e) {
      setPreview(null);
      setError(e.message);
    }
  };
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5e6) return setError("That file is over 5 MB. Export a shorter date range.");
    const r = new FileReader();
    r.onload = () => {
      setText(String(r.result));
      tryParse(String(r.result));
    };
    r.onerror = () => setError("Couldn't read that file. Try exporting it again as CSV.");
    r.readAsText(f);
  };
  return (
    <Sheet title="Your data" onClose={onClose}>
      <section className="card stack">
        <div className="row between">
          <div className="h3">{state.source === "import" ? "Using your statement" : "Using Riya's demo data"}</div>
          {state.source === "import" && (
            <button
              className="btn small"
              onClick={() => {
                dispatch({ type: "set", patch: { source: "demo", csv: null, overrides: {}, manual: {}, aiTags: {}, goals: DEMO.goals, settings: { ...s, name: DEMO.name, currentBalance: null } } });
                setToast("Back to the demo.");
                go("today");
                onClose();
              }}
            >
              Back to demo
            </button>
          )}
        </div>
        <p className="sub">{`${parsed.transactions.length} transactions, ${shortDate(parsed.transactions[0].date)} to ${shortDate(parsed.transactions[parsed.transactions.length - 1].date)}.`}</p>
      </section>

      <section className="stack">
        <div className="label">Import a bank statement (CSV)</div>
        <p className="sub">Most banks let you download a statement as CSV or Excel (save Excel as CSV). Date, description and amount or debit/credit columns are enough.</p>
        <label className="btn" htmlFor="csv-file" style={{ position: "relative" }}>
          <Icon name="upload" size={16} />
          Choose CSV file
          <input id="csv-file" type="file" accept=".csv,text/csv,text/plain" onChange={onFile} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
        </label>
        <label className="field" htmlFor="csv-text">
          Or paste it here
          <textarea id="csv-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance" />
        </label>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn small" onClick={() => tryParse(text)} disabled={!text.trim()}>
            Check file
          </button>
          <button
            className="btn small ghost"
            onClick={() => {
              const sample = demoCsv.split("\n").slice(0, 40).join("\n");
              setText(sample);
              tryParse(sample);
            }}
          >
            Paste a sample
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {preview && (
          <div className="card stack">
            <b>{`Found ${preview.res.transactions.length} transactions`}</b>
            <p className="sub">{`${shortDate(preview.res.transactions[0].date)} to ${shortDate(preview.res.transactions[preview.res.transactions.length - 1].date)}${preview.res.closingBalance != null ? ` · closing balance ${rupees(preview.res.closingBalance)}` : ""}`}</p>
            {preview.res.warnings.length > 0 && <p className="note">{`${preview.res.warnings.length} row${preview.res.warnings.length > 1 ? "s" : ""} skipped (unreadable dates).`}</p>}
            {preview.res.closingBalance == null && (
              <label className="field" htmlFor="cur-bal">
                Current balance (₹), the file has no balance column
                <input id="cur-bal" inputMode="numeric" value={s.currentBalance ?? ""} onChange={(e) => dispatch({ type: "settings", patch: { currentBalance: e.target.value ? Number(e.target.value.replace(/[^0-9.]/g, "")) : null } })} />
              </label>
            )}
            <button
              className="btn primary"
              onClick={() => {
                dispatch({ type: "set", patch: { source: "import", csv: preview.csv, overrides: {}, manual: {}, aiTags: {}, goals: [], settings: { ...s, name: s.name === DEMO.name ? "" : s.name } } });
                setToast("Statement loaded. Everything below is your numbers now.");
                go("today");
                onClose();
              }}
            >
              Use this statement
            </button>
          </div>
        )}
      </section>

      <section className="stack">
        <div className="label">Settings</div>
        <div className="grid2">
          <label className="field" htmlFor="set-name">
            Your name
            <input id="set-name" value={s.name} onChange={(e) => dispatch({ type: "settings", patch: { name: e.target.value } })} />
          </label>
          <label className="field" htmlFor="set-day">
            Money arrives on day
            <select id="set-day" value={s.incomeDay} onChange={(e) => dispatch({ type: "settings", patch: { incomeDay: Number(e.target.value) } })}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field" htmlFor="set-buffer">
          {`Keep spare (buffer): ${rupees(s.buffer)}`}
          <input id="set-buffer" type="range" min="0" max="2000" step="100" value={s.buffer} onChange={(e) => dispatch({ type: "settings", patch: { buffer: Number(e.target.value) } })} />
        </label>
      </section>

      <section className="card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <Icon name="shield" size={18} className="gold" />
          <p className="sub">Your statement is read and analysed inside this browser and never uploaded. Only when you ask the assistant a question does a summary of your numbers go to Claude, after you allow it.</p>
        </div>
      </section>
      <button
        className="btn ghost small"
        style={{ alignSelf: "center" }}
        onClick={() => {
          dispatch({ type: "reset" });
          setToast("Reset to the demo.");
          go("today");
          onClose();
        }}
      >
        Reset everything
      </button>
    </Sheet>
  );
}
