// Small, dependency-free helpers shared by the engine. Dates are ISO day strings
// ("2026-09-12") handled in UTC so results never shift with the viewer's time zone.

export const DAY_MS = 86400000;

/** Deterministic PRNG (mulberry32) so demo data and simulations are reproducible. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.normal = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  next.lognormal = (median, sigma) => median * Math.exp(sigma * next.normal());
  next.poisson = (lambda) => {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= next();
    } while (p > L);
    return k - 1;
  };
  return next;
}

export function toDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => iso(new Date(toDate(s).getTime() + n * DAY_MS));
/** a - b in whole days */
export const diffDays = (a, b) => Math.round((toDate(a) - toDate(b)) / DAY_MS);
export const weekday = (s) => toDate(s).getUTCDay(); // 0 = Sunday
export const dayOfMonth = (s) => toDate(s).getUTCDate();
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
export const todayISO = () => {
  const d = new Date();
  return iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
};

export function rangeDays(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const rupees = (n) => (n < 0 ? "−₹" : "₹") + inr.format(Math.round(Math.abs(n)));
export const pct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const shortDate = (s) => `${dayOfMonth(s)} ${MONTHS[toDate(s).getUTCMonth()]}`;
export const weekdayName = (s) => WD[weekday(s)];
export const WEEKDAYS = WD;

export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
export const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);
export function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export const median = (arr) => quantile([...arr].sort((a, b) => a - b), 0.5);
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round = (x, step = 1) => Math.round(x / step) * step;
