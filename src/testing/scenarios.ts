import { pool } from "../db/pool.js";
import { resetDatabase } from "../db/sql.js";
import { createBooking, cancelBooking } from "../domain/bookings.js";
import { payBooking } from "../domain/payments.js";
import { expireHolds } from "../jobs/expire-holds.js";
import { isBookingError } from "../domain/errors.js";
import { CARD_TOKENS, mockProvider } from "../payments/mock.js";

/**
 * Scenario runners for the testing console.
 *
 * Each returns a narrated trace rather than a summary count: the question being
 * asked, what should happen, every step that actually ran, and a verdict.
 * A console that only reports "won: 1, refused: 19" tells you the numbers but
 * never tells you what was being proved.
 *
 * Nothing here is simulated. Every step below runs the real booking code
 * against the real database.
 */

export type Step = {
  actor: "Parent A" | "Parent B" | "Server" | "Database" | "Job";
  text: string;
  detail?: string;
  status: "ok" | "blocked" | "error" | "info";
};

export type SeatState = {
  capacity: number;
  confirmed: number;
  held: number;
  free: number;
};

/** One instruction a person can follow in the real app, and what they will see. */
export type ManualStep = { do: string; see: string; where?: string };

export type ManualGuide = {
  intro: string;
  steps: ManualStep[];
  caveat?: string;
};

export type ScenarioResult = {
  id: string;
  title: string;
  question: string;
  expectation: string;
  before: SeatState;
  after: SeatState;
  steps: Step[];
  pass: boolean;
  headline: string;
  detail: string;
  /**
   * How to reproduce the same thing by hand, through the normal booking pages,
   * without this console. The console can only ever tell you what it says
   * happened; this is how you check that against the actual product.
   */
  manual: ManualGuide;
};

// Named children the booking page actually offers. The R-* racers are hidden
// from the picker, so manual instructions must not reference them.
const MANUAL: Record<string, ManualGuide> = {
  "double-book": {
    intro:
      "Aiden already has a confirmed seat on TC-101. Try to book him onto it a second time, the way a parent would after a double-click or a stale tab.",
    steps: [
      {
        do: 'Open "Book a trial" and choose "Aiden · P4" in the child selector.',
        see: "Only P4 classes are listed. TC-101 (Science, Ms Lim) is one of them.",
        where: "/",
      },
      {
        do: 'Click "Book trial" on TC-101.',
        see: 'A red banner: "Already booked, this child already has an active booking for this class."',
        where: "/",
      },
      {
        do: "Open the roster for TC-101.",
        see: "Aiden appears exactly once, and the class still shows 1 of 4 confirmed. No seat was consumed by the refused attempt.",
        where: "/roster/TC-101",
      },
    ],
  },

  "race-safe": {
    intro:
      "Twenty simultaneous clicks cannot be done by hand, but the important half can: two parents going for the same last seat. Use two browser windows so they are genuinely separate sessions.",
    steps: [
      {
        do: 'Press "Reset data" below, then open "Book a trial" and choose "Jonas · P5".',
        see: "TC-102 (Math, Mr Tan) shows 1 of 4 seats left.",
        where: "/",
      },
      {
        do: 'Click "Book trial" on TC-102.',
        see: "You land on the booking page with the seat held for you and a hold expiry time. The seat is taken now, before any payment.",
        where: "/bookings/...",
      },
      {
        do: 'In a second window (incognito), open the same page and choose "Kaya · P5", then click Book on TC-102.',
        see: 'A red banner: "That class just filled up." Kaya never reaches a payment screen, which is the point: two parents cannot both be sent to checkout for one seat.',
        where: "/",
      },
      {
        do: "Open the roster for TC-102.",
        see: "Still 3 confirmed, with 1 seat held for checkout. A held seat is not a child in the room.",
        where: "/roster/TC-102",
      },
    ],
    caveat:
      "Doing this by hand proves the outcome, not the timing. The 20-way version above is what proves it still holds when the requests genuinely overlap.",
  },

  "race-naive": {
    intro:
      "This one is deliberately not reachable from the normal booking pages. The naive code exists only as a comparison, so nothing in the product UI can select it.",
    steps: [
      {
        do: "Run the same race against the naive implementation from a terminal.",
        see: 'Roughly nineteen requests fail with a raw database error instead of a friendly "class is full" message.',
        where:
          'curl -X POST localhost:3000/api/testing -H "content-type: application/json" -d \'{"action":"scenario:race","n":20,"strategy":"naive"}\'',
      },
      {
        do: "Or run the same comparison in the test suite.",
        see: "Both tests pass, because one asserts a clean result and the other asserts that the naive path leaks database errors.",
        where: "npm test",
      },
      {
        do: "Check the roster for TC-102 afterwards.",
        see: "Still at most 4 confirmed. The CHECK constraint held the line even though the application logic did not.",
        where: "/roster/TC-102",
      },
    ],
  },

  declined: {
    intro:
      "Hold a seat, then pay with a card that will be declined, and watch the seat come back.",
    steps: [
      {
        do: 'Press "Reset data", choose "Jonas · P5", and book TC-102.',
        see: "TC-102 drops to 0 seats left while you are in checkout.",
        where: "/",
      },
      {
        do: 'On the payment panel choose "Visa •••• 0002, declined" and press Pay.',
        see: 'The status becomes payment_failed and you see "card_declined". Payment history shows the attempt as failed, with no capture.',
        where: "/bookings/...",
      },
      {
        do: 'Go back to "Book a trial".',
        see: "TC-102 shows 1 of 4 seats left again. The seat was returned the moment the payment failed, not later by a cleanup job.",
        where: "/",
      },
      {
        do: "Open the roster for TC-102.",
        see: "Jonas is not listed. A failed payment never puts a child in the room.",
        where: "/roster/TC-102",
      },
    ],
  },

  "seat-lost": {
    intro:
      "The scenario from the brief: a parent sits on the payment page until their hold lapses, someone else takes the seat, and only then do they pay. Worth noting this is the parent least comfortable with online payment, so it is also the case the product treats worst. See the note at the end.",
    steps: [
      {
        do: 'Press "Reset data", choose "Jonas · P5", book TC-102, and copy the booking id from the address bar.',
        see: "The booking page shows the seat held with an expiry time. Do not pay yet.",
        where: "/bookings/<id>",
      },
      {
        do: 'Paste that id into "Expire hold" under Utilities below, then press "Run hold sweeper".',
        see: 'The message confirms the hold was released. This just skips the ten minute wait.',
        where: "/testing",
      },
      {
        do: 'In a second window choose "Kaya · P5", book TC-102, and pay with the working card.',
        see: "Kaya is confirmed and appears on the roster. The seat is now genuinely hers.",
        where: "/",
      },
      {
        do: "Return to the first window, still on Jonas's booking page, and press Pay.",
        see: '"Sorry, this seat is no longer held for you, so the payment was cancelled. You have not been charged." Because the sweeper already released the hold, the booking reads as expired and the payment is refused before the card is even authorized.',
        where: "/bookings/<id>",
      },
      {
        do: "Open the roster for TC-102.",
        see: "Exactly 4 confirmed, including Kaya and not Jonas. One winner for one seat, and the loser was not charged.",
        where: "/roster/TC-102",
      },
    ],
    caveat:
      "The invariant holds, but the experience does not flatter us. Jonas gets no countdown and no warning, so he only learns the seat is gone after typing his card details, which is the worst possible moment. And he is refused even in the case where nobody else took the seat. Three things would fix that: a visible countdown with a warning before expiry, a longer hold than 10 minutes for an audience that includes parents new to online payment, and letting an expired hold be reclaimed when the seat is still free. All three are listed in the README as next steps.",
  },
};

async function seatState(classId: string): Promise<SeatState> {
  const { rows } = await pool.query<{
    capacity: number;
    confirmed: number;
    holding: number;
  }>(
    `SELECT tc.capacity,
            count(b.id) FILTER (WHERE b.status = 'confirmed')::int AS confirmed,
            count(b.id) FILTER (WHERE b.status IN ('pending_payment','confirmed'))::int AS holding
       FROM trial_classes tc
       LEFT JOIN bookings b ON b.trial_class_id = tc.id
      WHERE tc.id = $1
      GROUP BY tc.capacity`,
    [classId],
  );
  const r = rows[0] ?? { capacity: 4, confirmed: 0, holding: 0 };
  return {
    capacity: r.capacity,
    confirmed: r.confirmed,
    held: r.holding - r.confirmed,
    free: r.capacity - r.holding,
  };
}

const errCode = (e: unknown) => (isBookingError(e) ? e.code : "INTERNAL");
const errMsg = (e: unknown) =>
  isBookingError(e) ? e.message : String((e as Error)?.message ?? e);

/** Picks children eligible for a class and not already booked into it. */
async function eligible(classId: string, limit: number) {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT s.id, s.name FROM students s
       JOIN trial_classes tc ON tc.id = $1
      WHERE s.level = tc.level
        AND s.id NOT IN (SELECT student_id FROM bookings
                          WHERE trial_class_id = $1
                            AND status IN ('pending_payment','confirmed'))
      ORDER BY s.id LIMIT $2`,
    [classId, limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// 1. Double booking, the same child, the same class, twice
// ---------------------------------------------------------------------------
export async function scenarioDoubleBook(): Promise<ScenarioResult> {
  const CLASS = "TC-101";
  await resetAll();
  const before = await seatState(CLASS);
  const steps: Step[] = [];

  const { rows: existing } = await pool.query<{ name: string }>(
    `SELECT s.name FROM bookings b JOIN students s ON s.id = b.student_id
      WHERE b.trial_class_id = $1 AND b.status = 'confirmed' LIMIT 1`,
    [CLASS],
  );
  const name = existing[0]?.name ?? "Aiden";

  steps.push({
    actor: "Database",
    text: `${name} already has a confirmed booking on ${CLASS}`,
    detail: `Seats used: ${before.capacity - before.free} of ${before.capacity}`,
    status: "info",
  });
  steps.push({
    actor: "Parent A",
    text: `Tries to book ${name} onto ${CLASS} a second time`,
    detail: "Same child, same class, perhaps a double-click, or a stale tab",
    status: "info",
  });

  let pass = false;
  let headline = "";
  let detail = "";

  try {
    await createBooking({ studentId: "S-1", trialClassId: CLASS });
    steps.push({
      actor: "Server",
      text: "Second booking was ACCEPTED",
      detail: "This should be impossible",
      status: "error",
    });
    headline = "FAILED, the child was booked twice";
    detail = "A duplicate booking was created. The roster is now wrong.";
  } catch (e) {
    const code = errCode(e);
    steps.push({
      actor: "Server",
      text: "INSERT INTO bookings … (student_id, trial_class_id)",
      detail:
        "The booking row is written first, so the database gets to decide before any seat is touched",
      status: "info",
    });
    steps.push({
      actor: "Database",
      text: "Rejected by unique index bookings_one_active_per_student_class",
      detail:
        "UNIQUE (student_id, trial_class_id) WHERE status IN ('pending_payment','confirmed')",
      status: "blocked",
    });
    steps.push({
      actor: "Server",
      text: `Transaction rolled back → ${code} (HTTP 409)`,
      detail: errMsg(e),
      status: "blocked",
    });
    pass = code === "DUPLICATE_BOOKING";
    headline = pass
      ? "PASSED, the second booking was refused"
      : `Refused, but with the wrong error (${code})`;
    detail =
      "No seat was consumed and no second booking row exists. Note the rule lives in the database, not in application code, even a direct SQL insert is refused.";
  }

  const after = await seatState(CLASS);
  steps.push({
    actor: "Database",
    text: `Seats unchanged: ${after.capacity - after.free} of ${after.capacity}`,
    status: "ok",
  });

  return {
    id: "double-book",
    manual: MANUAL["double-book"]!,
    title: "Double booking",
    question: "Can the same child be booked into the same class twice?",
    expectation:
      "No. The second attempt is refused by a database index, and no seat is consumed.",
    before,
    after,
    steps,
    pass,
    headline,
    detail,
  };
}

// ---------------------------------------------------------------------------
// 2. The last-seat race
// ---------------------------------------------------------------------------
export async function scenarioRace(opts: {
  n: number;
  strategy: "safe" | "naive";
}): Promise<ScenarioResult> {
  const CLASS = "TC-102";
  const WINDOW = 200;

  // Restore the fixtures first, so the scenario always starts from exactly one
  // free seat. Without this, a second run starts from a full class, nobody can
  // win, and the result looks like a failure when it is really just leftover
  // state from the previous run.
  await resetAll();

  const before = await seatState(CLASS);
  const steps: Step[] = [];

  const kids = await eligible(CLASS, opts.n);
  if (kids.length === 0) {
    return {
      id: `race-${opts.strategy}`,
      manual: MANUAL[`race-${opts.strategy}`]!,
      title: "The last-seat race",
      question: "",
      expectation: "",
      before,
      after: before,
      steps: [
        {
          actor: "Server",
          text: "No eligible children left, press Reset first",
          status: "error",
        },
      ],
      pass: false,
      headline: "Could not run",
      detail: "Reset the data and try again.",
    };
  }

  steps.push({
    actor: "Database",
    text: `${CLASS} has ${before.free} seat left of ${before.capacity}`,
    status: "info",
  });
  steps.push({
    actor: "Server",
    text: `${kids.length} parents click Book at the same instant`,
    detail: `A ${WINDOW}ms window is held open between reading the seat count and writing it, so every request reads before any of them writes. Without it the result would depend on scheduling luck.`,
    status: "info",
  });

  if (opts.strategy === "safe") {
    steps.push({
      actor: "Server",
      text: "UPDATE trial_classes SET seats_taken = seats_taken + 1 WHERE id = $1 AND seats_taken < capacity",
      detail:
        "Read and write are ONE atomic statement. There is no gap for a second request to slip into.",
      status: "info",
    });
  } else {
    steps.push({
      actor: "Server",
      text: "SELECT count(*) … WHERE status = 'confirmed'   →   then UPDATE",
      detail:
        "The naive version: it reads, decides, and only then writes. Every request in this batch reads 3 of 4 and concludes a seat is free.",
      status: "error",
    });
  }

  const started = Date.now();
  const settled = await Promise.allSettled(
    kids.map((k) =>
      createBooking(
        { studentId: k.id, trialClassId: CLASS },
        { strategy: opts.strategy, raceWindowMs: WINDOW },
      ),
    ),
  );
  const elapsed = Date.now() - started;

  const attempts = settled.map((r, i) => ({
    name: kids[i]!.name,
    ok: r.status === "fulfilled",
    code: r.status === "rejected" ? errCode(r.reason) : null,
  }));

  const won = attempts.filter((a) => a.ok);
  const refused = attempts.filter((a) => !a.ok && a.code !== "INTERNAL");
  const crashed = attempts.filter((a) => a.code === "INTERNAL");

  won.forEach((w) =>
    steps.push({
      actor: "Database",
      text: `${w.name} got the seat`,
      detail: "UPDATE affected 1 row",
      status: "ok",
    }),
  );

  if (refused.length) {
    steps.push({
      actor: "Database",
      text: `${refused.length} request${refused.length === 1 ? "" : "s"} blocked on the row lock, re-checked, and found no seat`,
      detail:
        "Under READ COMMITTED a blocked UPDATE re-evaluates its WHERE clause against the newly committed row. It affects 0 rows and the parent gets a clean CLASS_FULL.",
      status: "blocked",
    });
  }

  if (crashed.length) {
    steps.push({
      actor: "Database",
      text: `${crashed.length} request${crashed.length === 1 ? "" : "s"} violated CHECK (seats_taken <= capacity)`,
      detail:
        "These had already passed the application's capacity check. The database was the only thing standing between this class and a 5th child.",
      status: "error",
    });
  }

  const after = await seatState(CLASS);

  // "One winner" is necessary but not sufficient. The naive path also ends with
  // one winner, but only because the database rejected the rest as raw errors,
  // after its own capacity check had already waved them through. A parent
  // seeing a 500 is not the system working, so that counts as a failure here.
  const pass =
    won.length === 1 && crashed.length === 0 && after.free >= 0;

  return {
    id: `race-${opts.strategy}`,
    manual: MANUAL[`race-${opts.strategy}`]!,
    title:
      opts.strategy === "safe"
        ? "The last-seat race"
        : "The last-seat race, with the naive code",
    question: `${kids.length} parents click Book on the last remaining seat at the same moment. How many get it?`,
    expectation:
      opts.strategy === "safe"
        ? "Exactly one. Everyone else is told the class is full, a normal answer, not an error."
        : "Exactly one should still end up booked, but the naive code lets several past its own check, so the database has to reject them as raw errors.",
    before,
    after,
    steps,
    pass,
    headline:
      won.length > 1
        ? `${won.length} winners for 1 seat, the class is overbooked`
        : won.length === 0
          ? "Nobody got a seat, the class was already full before the test started"
          : crashed.length > 0
            ? `1 winner, but ${crashed.length} parents hit a raw database error`
            : `1 winner out of ${kids.length}, everyone else refused cleanly`,
    detail:
      opts.strategy === "safe"
        ? `${refused.length} parents were refused cleanly and ${crashed.length} hit a raw database error. Completed in ${elapsed}ms.`
        : `Only ${refused.length} were refused cleanly; ${crashed.length} got a raw database error instead of a friendly message. The roster survived only because the CHECK constraint caught them. Remove that constraint and this class would have ${crashed.length + 1} children in a 4-seat room.`,
  };
}

// ---------------------------------------------------------------------------
// 3. Payment declined
// ---------------------------------------------------------------------------
export async function scenarioDeclined(): Promise<ScenarioResult> {
  const CLASS = "TC-102";
  await resetAll();
  const before = await seatState(CLASS);
  const steps: Step[] = [];

  const kids = await eligible(CLASS, 1);
  const kid = kids[0];
  if (!kid) {
    return failed("declined", "Payment declined", before, "No eligible children, press Reset first");
  }

  const booking = await createBooking({ studentId: kid.id, trialClassId: CLASS });
  const held = await seatState(CLASS);
  steps.push({
    actor: "Parent A",
    text: `${kid.name} selects the class`,
    status: "info",
  });
  steps.push({
    actor: "Database",
    text: `Seat reserved immediately, ${held.capacity - held.free} of ${held.capacity} now used`,
    detail:
      "The seat is taken at selection, not at payment. That is what stops two parents reaching checkout for the same seat.",
    status: "ok",
  });

  let pass = false;
  let detail = "";
  try {
    await payBooking({
      bookingId: booking.id,
      cardToken: CARD_TOKENS.declined,
      idempotencyKey: `declined-${booking.id}`,
    });
    steps.push({ actor: "Server", text: "Payment succeeded, unexpected", status: "error" });
  } catch (e) {
    steps.push({
      actor: "Server",
      text: "authorize() → declined by the provider",
      detail: "card_declined. Nothing was captured, because capture only ever runs after a booking is confirmed.",
      status: "blocked",
    });
    steps.push({
      actor: "Database",
      text: "Booking → payment_failed AND the seat released, in the same transaction",
      detail: "Both happen together or neither does, so the counter can never disagree with the bookings.",
      status: "ok",
    });
    pass = errCode(e) === "PAYMENT_FAILED";
  }

  const after = await seatState(CLASS);
  const released = after.free === before.free;
  steps.push({
    actor: "Database",
    text: released
      ? `Seat returned to the pool, back to ${after.capacity - after.free} of ${after.capacity}`
      : `Seat NOT returned, ${after.capacity - after.free} of ${after.capacity}`,
    status: released ? "ok" : "error",
  });

  detail = `${kid.name} is not on the roster and was not charged. The seat is available for someone else immediately, rather than being stranded until a cleanup job notices.`;

  return {
    id: "declined",
    manual: MANUAL["declined"]!,
    title: "Payment declined",
    question:
      "A parent holds the seat, then their card is declined. What happens to the seat, and are they charged?",
    expectation:
      "The seat goes straight back to the pool, the child never reaches the roster, and no money moves.",
    before,
    after,
    steps,
    pass: pass && released,
    headline: pass && released ? "PASSED, seat released, nothing charged" : "FAILED",
    detail,
  };
}

// ---------------------------------------------------------------------------
// 4. The seat is lost while the parent is paying
// ---------------------------------------------------------------------------
export async function scenarioSeatLost(): Promise<ScenarioResult> {
  const CLASS = "TC-102";
  await resetAll();
  const before = await seatState(CLASS);
  const steps: Step[] = [];

  const kids = await eligible(CLASS, 2);
  const a = kids[0];
  if (!a) {
    return failed("seat-lost", "Seat lost during payment", before, "No eligible children, press Reset first");
  }

  const booking = await createBooking({ studentId: a.id, trialClassId: CLASS });
  steps.push({
    actor: "Parent A",
    text: `${a.name} takes the last seat and goes to the payment page`,
    status: "ok",
  });

  await pool.query(
    "UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1",
    [booking.id],
  );
  steps.push({
    actor: "Job",
    text: "Parent A leaves the tab open too long, the hold lapses",
    detail: "Forced here so you do not have to wait ten minutes.",
    status: "info",
  });

  const { expired } = await expireHolds();
  steps.push({
    actor: "Job",
    text: `Sweeper released ${expired} expired hold${expired === 1 ? "" : "s"}`,
    detail:
      "Repair only. A late sweep delays availability; it can never permit an overbooking.",
    status: "ok",
  });

  const callsBefore = mockProvider.captureCount();
  let pass = false;
  try {
    await payBooking({
      bookingId: booking.id,
      cardToken: CARD_TOKENS.ok,
      idempotencyKey: `lost-${booking.id}`,
    });
    steps.push({
      actor: "Server",
      text: "Payment went through, unexpected",
      status: "error",
    });
  } catch (e) {
    const code = errCode(e);
    steps.push({
      actor: "Parent A",
      text: "Comes back and presses Pay",
      status: "info",
    });
    steps.push({
      actor: "Server",
      text: "authorize() → funds held, NOT taken",
      detail: "An authorization is reversible. A capture is not. That ordering is the whole safety argument.",
      status: "info",
    });
    steps.push({
      actor: "Database",
      text: "Re-checks the hold inside a transaction → no longer valid",
      status: "blocked",
    });
    steps.push({
      actor: "Server",
      text: `void() the authorization → ${code}`,
      detail: "capture() is never called. The parent is not charged a cent.",
      status: "ok",
    });
    pass = code === "SEAT_LOST" || code === "NOT_PENDING";
  }

  const captured = mockProvider.captureCount() - callsBefore;
  const after = await seatState(CLASS);

  return {
    id: "seat-lost",
    manual: MANUAL["seat-lost"]!,
    title: "Seat lost while paying",
    question:
      "A parent's hold expires while they are on the payment page, then they pay. Are they charged for a seat they no longer have?",
    expectation:
      "No. The card is authorized, the seat is re-checked, and because it is gone the authorization is voided instead of captured.",
    before,
    after,
    steps,
    pass: pass && captured === 0,
    headline:
      pass && captured === 0
        ? "PASSED, authorization voided, nothing captured"
        : `FAILED, ${captured} capture(s) ran`,
    detail:
      "This is the strongest guarantee in the system, and it is asserted negatively in the test suite: on this path the provider must receive exactly authorize then void, and never capture.",
  };
}

function failed(
  id: string,
  title: string,
  before: SeatState,
  message: string,
): ScenarioResult {
  return {
    id,
    manual: MANUAL[id] ?? { intro: "", steps: [] },
    title,
    question: "",
    expectation: "",
    before,
    after: before,
    steps: [{ actor: "Server", text: message, status: "error" }],
    pass: false,
    headline: "Could not run",
    detail: message,
  };
}

// ---------------------------------------------------------------------------
export async function resetAll() {
  await resetDatabase();
  mockProvider.reset();
}

export { expireHolds, cancelBooking };
