// "Clean and categorise": a precise brand-rule layer, then a multinomial Naive Bayes
// model over word + character n-grams for everything the rules do not know
// (local shops, new merchants, friends). Corrections from the user retrain it
// instantly. Low-confidence spends can be sent to an LLM (see assistant.js).

import { BRANDS, LOCAL_MERCHANTS, PEOPLE, CATEGORY_IDS } from "./taxonomy.js";
import { rng } from "./util.js";

export const LOW_CONFIDENCE = 0.6;

const BUSINESS_WORDS =
  /\b(store|stores|mart|cafe|canteen|centre|center|point|shop|house|travels|tours|medical|medicos|pharmacy|clinic|hospital|restaurant|dhaba|sweets|kirana|bazaar|retail|limited|ltd|pvt|private|services|enterprises|traders|stall|corner|kiosk|hub|zone|gym|fitness|cinemas|books?|stationery|xerox|print|petrol|pump|bus|rides|bikes|digital|fashion|lifestyle|footwear|gallery|depot|fee|bill|recharge|prepaid|premium|tiffin|bhojnalaya|juice|parlour|dairy|booth|basket|mess|court|bar|india|supermarket)\b/i;

// Common Indian first names: a P2P transfer to a person is "Friends & splits".
export const FIRST_NAMES = new Set(
  ("aarav aarti abhay abhishek aditi aditya ajay akash akshay alok aman amit amrita ananya anil anita anjali ankit ankita anmol " +
    "anshul anuj anupam anushka arjun arnav aryan ashish ayesha bhavna chetan deepak deepika dev devansh dhruv divya gaurav gautam " +
    "harsh harshita isha ishaan jatin jay karan kartik kavya kirti krishna kunal lakshmi madhav manish manoj meera megha mohit " +
    "nandini naveen neha nikhil nisha om pallavi pooja pranav prateek priya rahul raj rajat rajesh rakesh ravi rhea riddhi ritu " +
    "riya rohan rohit sachin sahil sakshi sameer sanjay saurabh shivam shreya shruti siddharth simran sneha sonal suresh swati " +
    "tanvi tara tarun tushar varun ved vidya vikram vinay vishal vivek yash yashika zara zoya")
    .split(" "),
);

// Generic words that give a local shop's category away (no shop names, so the
// held-out evaluation stays honest). Checked against the merchant name only.
const KEYWORDS = [
  ["eating_out", /\b(canteen|cafe|chai|tea|coffee|dhaba|restaurant|tiffin|bhojnalaya|juice|momos?|maggi|rolls?|sweets|bakery|food court|mess|biryani|paratha|burger|thali|eatery|snacks|kitchen)\b/],
  ["education", /\b(xerox|photostat|print|printout|stationery|books?|kitab|library|exam|tuition|coaching|notebook|academy|classes)\b/],
  ["health", /\b(medical|medicos?|pharmacy|chemist|clinic|hospital|dental|labs?|diagnostics?|gym|fitness|wellness|health|doctor|dr)\b/],
  ["groceries", /\b(kirana|general store|provision|supermarket|grocery|groceries|dairy|milk|vegetables?|veg|fruits?|bazaar|basket|daily needs|mart)\b/],
  ["travel", /\b(travels?|tours|petrol|pump|fuel|bus|auto|rickshaw|yatri|bikes?|rides?|cab|taxi|petroleum|parking|toll|transport)\b/],
  ["entertainment", /\b(cinemas?|movies?|gaming|games?|bowling|concert|comedy|events?|amusement|fun|show|tickets)\b/],
  ["shopping", /\b(fashion|footwear|shoes?|lifestyle|apparel|clothing|garments|accessories|gift|electronics|digital|optical|watches)\b/],
  ["bills", /\b(prepaid|postpaid|fibernet|broadband|wifi|recharge|electricity|dth|subscription|mobile bill)\b/],
];

export const cleanText = (s) =>
  ` ${(s || "").toLowerCase().replace(/@/g, " @").replace(/[^a-z0-9@ ]+/g, " ").replace(/\s+/g, " ").trim()} `;

/** Deterministic, high-precision rules. Returns null when no rule fires. */
export function ruleCategory(txn) {
  if (txn.direction === "credit") return { cat: "income", conf: 0.99, source: "rule" };
  const t = cleanText(`${txn.merchant} ${txn.text || ""}`);
  for (const b of BRANDS) {
    for (const k of b.keys) if (t.includes(` ${k} `)) return { cat: b.cat, conf: 0.98, source: "rule", brand: b.name };
  }
  if (/ atm | cash wdl | cash withdrawal /.test(t)) return { cat: "other", conf: 0.95, source: "rule" };
  const name = cleanText(txn.merchant).trim();
  const words = name.split(" ");
  if (words.length >= 2 && words.length <= 3 && FIRST_NAMES.has(words[0]) && !BUSINESS_WORDS.test(name))
    return { cat: "friends", conf: 0.92, source: "rule" };
  for (const [cat, re] of KEYWORDS) if (re.test(name)) return { cat, conf: 0.85, source: "rule" };
  return null;
}

function features(text) {
  const t = cleanText(text).trim();
  const out = [];
  for (const w of t.split(" ")) {
    if (!w) continue;
    if (w.startsWith("@")) {
      out.push(`vpa:${w.slice(1)}`);
      continue;
    }
    if (/^\d+$/.test(w)) continue;
    if (w.length > 1) out.push(`w:${w}`);
    const p = `^${w}$`;
    for (let i = 0; i + 3 <= p.length; i++) out.push(`c:${p.slice(i, i + 3)}`);
  }
  return out;
}

export class NaiveBayes {
  constructor(alpha = 0.3, uniformPrior = true) {
    this.alpha = alpha;
    this.uniformPrior = uniformPrior;
    this.docs = {};
    this.counts = {};
    this.totals = {};
    this.vocab = new Set();
    this.nDocs = 0;
  }
  learn(text, cat, weight = 1) {
    const f = features(text);
    this.docs[cat] = (this.docs[cat] || 0) + weight;
    this.nDocs += weight;
    const c = (this.counts[cat] ||= {});
    for (const x of f) {
      c[x] = (c[x] || 0) + weight;
      this.totals[cat] = (this.totals[cat] || 0) + weight;
      this.vocab.add(x);
    }
  }
  /** Share of the payee's words the model has seen before (0 = a total stranger). */
  familiarity(name) {
    const words = cleanText(name).trim().split(" ").filter((w) => w.length > 2 && !/^\d+$/.test(w) && !w.startsWith("@"));
    if (!words.length) return 0;
    return words.filter((w) => this.vocab.has(`w:${w}`)).length / words.length;
  }
  predict(text) {
    const f = features(text);
    const V = this.vocab.size + 1;
    const scores = {};
    for (const cat of Object.keys(this.docs)) {
      let s = this.uniformPrior ? 0 : Math.log(this.docs[cat] / this.nDocs);
      const c = this.counts[cat] || {};
      const tot = this.totals[cat] || 0;
      for (const x of f) s += Math.log(((c[x] || 0) + this.alpha) / (tot + this.alpha * V));
      scores[cat] = s;
    }
    const max = Math.max(...Object.values(scores));
    let z = 0;
    for (const k in scores) z += Math.exp(scores[k] - max);
    let best = "other";
    let bestP = 0;
    const probs = {};
    for (const k in scores) {
      probs[k] = Math.exp(scores[k] - max) / z;
      if (probs[k] > bestP) {
        bestP = probs[k];
        best = k;
      }
    }
    return { cat: best, conf: bestP, probs };
  }
}

// ---------- training data (synthetic, labelled) ----------
const FIRST = ["aditya", "ananya", "rohit", "kavya", "siddharth", "pooja", "manish", "divya", "tanvi", "harsh", "meera", "nikhil", "shreya", "yash", "riddhi", "aman", "simran", "dev", "tara", "kunal", "ritu", "varun", "anjali", "saurabh"];
const LAST = ["sharma", "gupta", "mishra", "khan", "menon", "pillai", "agarwal", "chauhan", "bose", "kulkarni", "rao", "saxena", "das", "jain", "thakur", "naidu", "yadav", "kaur"];
const NOTES = ["", "Paid via PhonePe", "UPI", "Payment from Phone", "Sent using Paytm UPI", "Pay to merchant"];
const P2P_NOTES = ["", "split", "dinner", "auto share", "returning", "thanks", "cab split", "movie"];

const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0;
const isHeldOut = (name) => hash(name) % 4 === 0;

function exampleFor(name, cat, r, person = false) {
  const vpaUser = name.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 12) || "merchant";
  const vpa = person
    ? `${vpaUser}@${r.pick(["okaxis", "oksbi", "okicici", "ybl", "paytm"])}`
    : r() < 0.5
      ? `${vpaUser}@${r.pick(["ybl", "paytm", "icici", "hdfcbank", "sbi"])}`
      : `q${r.int(100000, 999999)}@${r.pick(["ybl", "paytm", "axl"])}`;
  const note = person ? r.pick(P2P_NOTES) : r.pick(NOTES);
  return { merchant: name, vpa, text: `${vpa} ${note}`, direction: "debit", cat };
}
const exText = (ex) => `${ex.merchant} ${ex.text}`;

/** Build train/test sets; local merchants and synthetic people are split by name. */
export function buildDatasets(seed = 42) {
  const r = rng(seed);
  const train = [];
  const test = [];
  for (const [cat, names] of Object.entries(LOCAL_MERCHANTS)) {
    for (const name of names) {
      const bucket = isHeldOut(name) ? test : train;
      for (let k = 0; k < 3; k++) bucket.push(exampleFor(name, cat, r));
    }
  }
  for (const b of BRANDS) for (let k = 0; k < 2; k++) train.push({ merchant: b.name, vpa: b.vpa, text: `${b.vpa} ${r.pick(NOTES)}`, direction: "debit", cat: b.cat });
  for (let i = 0; i < 160; i++) {
    const name = `${r.pick(FIRST)} ${r.pick(LAST)}`;
    (isHeldOut(name) ? test : train).push(exampleFor(name, "friends", r, true));
  }
  for (const [name, vpa] of PEOPLE) train.push({ merchant: name, vpa, text: `${vpa} ${r.pick(P2P_NOTES)}`, direction: "debit", cat: "friends" });
  return { train, test };
}

export function trainModel(seed = 42) {
  const { train } = buildDatasets(seed);
  const model = new NaiveBayes();
  for (const ex of train) model.learn(exText(ex), ex.cat);
  return model;
}

function scores(pairs) {
  const cats = CATEGORY_IDS.filter((c) => c !== "other");
  const tp = {};
  const fp = {};
  const fn = {};
  let correct = 0;
  for (const [pred, truth] of pairs) {
    if (pred === truth) {
      correct++;
      tp[pred] = (tp[pred] || 0) + 1;
    } else {
      fp[pred] = (fp[pred] || 0) + 1;
      fn[truth] = (fn[truth] || 0) + 1;
    }
  }
  const f1s = cats
    .filter((c) => (tp[c] || 0) + (fn[c] || 0) > 0)
    .map((c) => {
      const p = (tp[c] || 0) / Math.max(1, (tp[c] || 0) + (fp[c] || 0));
      const rc = (tp[c] || 0) / Math.max(1, (tp[c] || 0) + (fn[c] || 0));
      return p + rc ? (2 * p * rc) / (p + rc) : 0;
    });
  return { accuracy: correct / pairs.length, macroF1: f1s.reduce((a, b) => a + b, 0) / f1s.length };
}

/**
 * Accuracy and macro-F1 on merchants and people the model never saw:
 * the full pipeline (rules, then Naive Bayes) and Naive Bayes on its own.
 */
export function evaluateModel(model, seed = 42) {
  const { test, train } = buildDatasets(seed);
  const pipeline = scores(test.map((ex) => [(ruleCategory(ex) || model.predict(exText(ex))).cat, ex.cat]));
  const nbOnly = scores(test.map((ex) => [model.predict(exText(ex)).cat, ex.cat]));
  const lowConf = test.filter((ex) => !ruleCategory(ex) && (model.predict(exText(ex)).conf < LOW_CONFIDENCE || model.familiarity(ex.merchant) < 0.5)).length / test.length;
  return { ...pipeline, nbAccuracy: nbOnly.accuracy, nbMacroF1: nbOnly.macroF1, lowConfidenceShare: lowConf, nTest: test.length, nTrain: train.length };
}

/**
 * Categorise every transaction. `overrides` maps merchantKey -> category (the user's
 * own corrections, highest priority); `aiTags` maps txn id -> category from the LLM.
 */
export function categoriseAll(txns, model, overrides = {}, aiTags = {}) {
  return txns.map((t) => {
    let res;
    if (overrides[t.merchantKey] && t.direction === "debit") res = { cat: overrides[t.merchantKey], conf: 1, source: "you" };
    else if (aiTags[t.id] && t.direction === "debit") res = { cat: aiTags[t.id], conf: 0.9, source: "ai" };
    else res = ruleCategory(t);
    if (!res) {
      const p = model.predict(`${t.merchant} ${t.text}`);
      const fam = model.familiarity(t.merchant);
      // Unsure: keep it out of the budget categories until someone (you or Claude) confirms.
      res = p.conf < LOW_CONFIDENCE || fam < 0.5 ? { cat: "other", conf: Math.min(p.conf, fam), source: "model", guess: p.cat, unsure: true } : { ...p, source: "model" };
    }
    return { ...t, category: res.cat, confidence: res.conf, source: res.source, guess: res.guess ?? null, unsure: !!res.unsure };
  });
}

/** Learn from a correction: the model updates immediately (weighted like 3 examples). */
export function teach(model, txn, cat) {
  model.learn(`${txn.merchant} ${txn.text}`, cat, 3);
}
