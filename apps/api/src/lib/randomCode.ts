import { randomInt } from "node:crypto";

// Shared by guests.ts (4-char guest codes, kept non-sequential for privacy — see
// docs/architecture.md) and flights.ts (3-char flight codes). A random code with a
// large-enough keyspace + check-and-retry is what actually fixes the concurrency
// bug a count-then-format counter has: two near-simultaneous creates can both read
// the same "current count" and produce the same next code (this really happened —
// see flights.ts's history — a handful of e2e specs creating flights in parallel
// was enough to hit it reliably). Not a true atomicity guarantee, but the
// collision odds become negligible once the keyspace is large relative to how many
// codes exist at once, which is exactly the accepted tradeoff already documented
// for guest codes in docs/tech-stack.md § Known cross-cutting risks.
const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function randomCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}
