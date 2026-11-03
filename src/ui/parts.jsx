import React, { useRef, useState } from "react";
import { rupees, shortDate, addDays, catLabel, WEEKDAYS } from "../engine/index.js";

const P = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  chart: "M3 3v18h18M7 15l4-4 3 3 6-7",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z",
  data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  alert: "M12 3 2 20h20L12 3zM12 10v4M12 17h.01",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  stop: "M6 6h12v12H6z",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  calendar: "M4 5h16v16H4zM4 9h16M8 3v4M16 3v4",
  shield: "M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6z",
  plus: "M12 5v14M5 12h14",
};

export function Icon({ name, size = 20, stroke = 2, className, label }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : "true"}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <path d={P[name]} />
    </svg>
  );
}

export function Sheet({ title, onClose, children }) {
  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="row between">
          <h2 className="sheet-title">{title}</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const SEV_LABEL = { critical: "Act now", warning: "Watch", info: "Heads-up", good: "On track" };
export function Alert({ a }) {
  return (
    <div className="alert" data-sev={a.severity}>
      <span className="sev">{SEV_LABEL[a.severity]}</span>
      <div className="min0">
        <p className="t">{a.title}</p>
        <p className="b">{a.body}</p>
      </div>
    </div>
  );
}

/** Balance across the budget cycle: actual, expected path and the likely band. */
export function RunwayChart({ a }) {
  const { cycle, forecast, actualPath } = a;
  const L = cycle.length;
  const W = 400;
  const H = 230;
  const m = { l: 46, r: 12, t: 14, b: 28 };
  const idx = (d) => Math.round((Date.parse(d) - Date.parse(cycle.start)) / 86400000) + 1;
  const actual = [{ x: 0, y: a.cycleStartBalance ?? actualPath[0]?.balance ?? 0 }, ...actualPath.map((p) => ({ x: idx(p.date), y: p.balance }))];
  const startX = cycle.dayIndex - 1;
  const proj = [{ x: startX, y: a.startBalance }, ...forecast.path.map((p) => ({ x: idx(p.date), y: p.balance }))];
  const band = forecast.mc.bands.map((b) => ({ x: idx(b.date), lo: b.p10, hi: b.p90, mid: b.p50 }));
  const ys = [...actual.map((p) => p.y), ...proj.map((p) => p.y), ...band.map((b) => b.lo), ...band.map((b) => b.hi), 0];
  let yMax = Math.max(...ys);
  let yMin = Math.min(...ys);
  const step = niceStep((yMax - yMin) / 4);
  yMax = Math.ceil(yMax / step) * step;
  yMin = Math.floor(yMin / step) * step;
  const sx = (x) => m.l + (x / L) * (W - m.l - m.r);
  const sy = (y) => m.t + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);
  const line = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
  const bandPath =
    band.length > 0
      ? `M${sx(startX)},${sy(a.startBalance)}` +
        band.map((b) => `L${sx(b.x).toFixed(1)},${sy(b.hi).toFixed(1)}`).join("") +
        [...band].reverse().map((b) => `L${sx(b.x).toFixed(1)},${sy(b.lo).toFixed(1)}`).join("") +
        `L${sx(startX)},${sy(a.startBalance)}Z`
      : "";
  const ticks = [];
  for (let v = yMin; v <= yMax + 1; v += step) ticks.push(v);
  const xTicks = [1, Math.round(L / 4), Math.round(L / 2), Math.round((3 * L) / 4), L];
  const run = forecast.lastFundedDay < L ? forecast.lastFundedDay : null;
  const runPt = run != null ? proj.find((p) => p.x === run + 1) : null;

  const wrap = useRef(null);
  const [hover, setHover] = useState(null);
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const day = Math.max(1, Math.min(L, Math.round(((x - m.l) / (W - m.l - m.r)) * L)));
    setHover(day);
  };
  let hv = null;
  if (hover != null) {
    const date = addDays(cycle.start, hover - 1);
    const act = actual.find((p) => p.x === hover);
    const b = band.find((p) => p.x === hover);
    const pr = proj.find((p) => p.x === hover);
    if (act && hover < cycle.dayIndex) hv = { day: hover, date, y: act.y, text: `${rupees(act.y)} at day end`, kind: "Actual" };
    else if (pr) hv = { day: hover, date, y: pr.y, text: `${rupees(pr.y)} expected`, sub: b ? `Likely ${rupees(b.lo)} to ${rupees(b.hi)}` : null, kind: "Forecast" };
  }
  return (
    <div ref={wrap} className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Balance over the month. Money lasts until day ${forecast.lastFundedDay} of ${L}.`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} className={v === 0 ? "zero" : "grid"} strokeWidth={v === 0 ? 1.2 : 1} />
            <text x={m.l - 6} y={sy(v) + 4} textAnchor="end">{shortMoney(v)}</text>
          </g>
        ))}
        {xTicks.map((d, i) => (
          <text key={d} x={sx(d)} y={H - 8} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>{`Day ${d}`}</text>
        ))}
        <path d={bandPath} className="band" />
        <path d={line(proj)} className="proj" strokeWidth="2" strokeDasharray="5 5" />
        <path d={line(actual)} className="actual" strokeWidth="2" />
        <circle cx={sx(startX)} cy={sy(a.startBalance)} r="4.5" className="dot" strokeWidth="2" />
        <line x1={sx(cycle.dayIndex - 0.5)} x2={sx(cycle.dayIndex - 0.5)} y1={m.t} y2={H - m.b} className="todayline" />
        <text x={sx(cycle.dayIndex - 0.5) + 4} y={m.t + 10} className="todaytext">Today</text>
        {runPt && (
          <g>
            <circle cx={sx(run + 0.5)} cy={sy(0)} r="5.5" className="runout" strokeWidth="2" />
            <text x={sx(run + 0.5) - 9} y={sy(0) + 17} textAnchor="end" className="runtext">{`Runs out after Day ${run}`}</text>
          </g>
        )}
        {hv && (
          <g>
            <line x1={sx(hv.day)} x2={sx(hv.day)} y1={m.t} y2={H - m.b} className="hoverline" />
            <circle cx={sx(hv.day)} cy={sy(hv.y)} r="4" className="hoverdot" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hv && (
        <div className="tip" style={{ left: `${Math.min(70, Math.max(2, (sx(hv.day) / W) * 100 - 15))}%` }}>
          <div>{`${hv.kind} for Day ${hv.day} (${shortDate(hv.date)})`}</div>
          <b>{hv.text}</b>
          {hv.sub && <div>{hv.sub}</div>}
        </div>
      )}
      <div className="legend">
        <span><i />Actual balance</span>
        <span><i className="dash" />Expected at current pace</span>
        <span><i className="band" />Likely range (80%)</span>
      </div>
    </div>
  );
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const shortMoney = (v) => (Math.abs(v) >= 1000 ? `${v < 0 ? "−" : ""}₹${(Math.abs(v) / 1000).toFixed(Math.abs(v) % 1000 ? 1 : 0)}k` : `${v < 0 ? "−" : ""}₹${Math.abs(v)}`);

/** This cycle by category, with a tick for the usual amount by the same day. */
export function CategoryBars({ pace, dayIndex, onPick, active }) {
  const rows = pace.filter((p) => p.now > 0 || (p.usual || 0) > 0).slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.now, r.usual || 0)));
  const [tip, setTip] = useState(null);
  return (
    <div className="bars">
      {rows.map((r) => {
        const pctNow = (r.now / max) * 100;
        const pctUsual = r.usual != null ? (r.usual / max) * 100 : null;
        const delta = r.usual ? Math.round((r.now / r.usual - 1) * 100) : null;
        return (
          <button
            key={r.id}
            type="button"
            className="barrow"
            data-dim={active && active !== r.id ? "true" : undefined}
            aria-pressed={active === r.id}
            onClick={() => onPick?.(r.id)}
            onPointerEnter={() => setTip(r.id)}
            onPointerLeave={() => setTip(null)}
            aria-label={`${r.label}: ${rupees(r.now)} this month${r.usual != null ? `, usually ${rupees(r.usual)} by day ${dayIndex}` : ""}`}
          >
            <span className="l">{r.id === "other" ? "Other and not sure yet" : r.label}</span>
            <span className="v">
              {rupees(r.now)}
              {delta != null && r.id !== "other" && Math.abs(delta) >= 10 && <span className="d" data-up={delta > 0 ? "true" : undefined}>{` ${delta > 0 ? "+" : ""}${delta}%`}</span>}
            </span>
            <span className="track">
              <span className="fill" style={{ width: `${pctNow}%` }} />
              {pctUsual != null && <span className="tick" style={{ left: `calc(${pctUsual}% - 1px)` }} />}
            </span>
            {tip === r.id && r.usual != null && <span className="note">{`Usually ${rupees(r.usual)} by Day ${dayIndex}, ${r.count} spend${r.count === 1 ? "" : "s"} this month`}</span>}
          </button>
        );
      })}
      <div className="legend">
        <span><i />This month</span>
        <span><i className="tickswatch" />Usual by Day {dayIndex}</span>
      </div>
    </div>
  );
}

export function WeekdayBars({ mult }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const max = Math.max(...mult);
  return (
    <div className="wk" role="img" aria-label="Spending by weekday relative to your average">
      {order.map((d) => (
        <div key={d}>
          <i style={{ height: `${(mult[d] / max) * 46}px` }} title={`${WEEKDAYS[d]}: ${Math.round(mult[d] * 100)}% of average`} />
          <span>{WEEKDAYS[d].slice(0, 2)}</span>
        </div>
      ))}
    </div>
  );
}

export const initials = (name) =>
  (name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export { catLabel };
