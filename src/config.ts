/**
 * Runtime configuration.
 *
 * The three knobs below the line are TEST-ONLY. They exist so a human can
 * reproduce a millisecond-scale race by hand, and each one is loud about it —
 * a reviewer should never have to guess whether a setting is load-bearing.
 */

function env(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${key} must be an integer, got "${raw}"`);
  return n;
}

export type BookingStrategy = "safe" | "naive";

export const config = {
  databaseUrl: env(
    "DATABASE_URL",
    "postgres://ottodot:ottodot@localhost:55432/ottodot",
  ),

  /** How long a seat is held while the parent is in checkout. */
  holdTtlSeconds: intEnv("HOLD_TTL_SECONDS", 600),

  /** Trial classes are capped at 4 by Ottodot; the DB enforces the real limit. */
  defaultCapacity: 4,

  // -------------------------------------------------------------------------
  // TEST-ONLY BELOW THIS LINE
  // -------------------------------------------------------------------------

  /**
   * Sleep injected between the capacity read and the seat write. Widens the
   * race window from microseconds to something two browser tabs can hit.
   * 0 in every normal run.
   */
  raceWindowMs: intEnv("RACE_WINDOW_MS", 0),

  /**
   * safe  = atomic conditional UPDATE (the real implementation)
   * naive = SELECT COUNT(*) then INSERT (the textbook race, kept so the test
   *         suite can be shown going red against it)
   */
  bookingStrategy: env("BOOKING_STRATEGY", "safe") as BookingStrategy,

  payment: {
    providerUrl: env("MOCK_PROVIDER_URL", "http://localhost:3000/mock-provider"),
    webhookSecret: env("PAYMENT_WEBHOOK_SECRET", "dev_only_not_a_real_secret"),
    latencyMs: intEnv("PAYMENT_PROVIDER_LATENCY_MS", 0),
  },
} as const;

if (config.bookingStrategy !== "safe" && config.bookingStrategy !== "naive") {
  throw new Error(
    `BOOKING_STRATEGY must be "safe" or "naive", got "${config.bookingStrategy}"`,
  );
}
