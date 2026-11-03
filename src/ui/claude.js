// Bridge to Claude when the app runs inside a Claude artifact viewer.
// Everywhere else (a plain browser, a Vercel deploy) `use()` is absent and the
// app answers with its on-device engine instead.

let samplePromise = null;

export function getSample() {
  if (!samplePromise) {
    samplePromise =
      typeof window !== "undefined" && window.claude && typeof window.claude.use === "function"
        ? window.claude.use("sample").catch(() => null)
        : Promise.resolve(null);
  }
  return samplePromise;
}

/** Error codes after which Claude stays off for this visit. */
export const PERMANENT = new Set(["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed", "session_expired"]);

export function errorCopy(code) {
  switch (code) {
    case "rate_limited":
      return "Claude is busy for you right now. Here's the on-device answer instead.";
    case "not_granted":
      return "Claude access wasn't allowed, so answers come from the on-device engine.";
    case "session_expired":
      return "Your Claude session expired. Sign in again to use Claude; on-device answers still work.";
    case "refused":
      return "Claude declined that one. Here's the on-device answer.";
    default:
      return "Claude didn't answer this time. Here's the on-device answer.";
  }
}
