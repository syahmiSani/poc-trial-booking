-- ===========================================================================
-- Trial booking POC — schema
--
-- Design rule for this file: anything that must remain true even if the
-- application layer is buggy, replaced, or bypassed entirely is expressed
-- HERE as a constraint, not in TypeScript. The three that matter are marked
-- INVARIANT below.
-- ===========================================================================

CREATE TYPE booking_status AS ENUM (
  'pending_payment',  -- holds a seat, parent is in checkout, hold has a TTL
  'confirmed',        -- holds a seat, payment captured, child is on the roster
  'payment_failed',   -- no seat, provider declined
  'expired',          -- no seat, hold TTL elapsed before payment
  'cancelled'         -- no seat, abandoned or lost the seat before capture
);

CREATE TYPE payment_status AS ENUM (
  'authorized',       -- funds held, NOT taken
  'captured',         -- funds taken — only ever after a booking is confirmed
  'voided',           -- authorization released without charging
  'failed',           -- provider declined
  'unknown'           -- timeout: the charge may or may not exist. Reconciled.
);


CREATE TABLE parents (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE students (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  level      TEXT NOT NULL CHECK (level IN ('P1','P2','P3','P4','P5','P6')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX students_parent_idx ON students (parent_id);


CREATE TABLE trial_classes (
  id           TEXT PRIMARY KEY,
  subject      TEXT NOT NULL CHECK (subject IN ('math','science')),
  level        TEXT NOT NULL CHECK (level IN ('P1','P2','P3','P4','P5','P6')),
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  teacher_name TEXT NOT NULL,
  capacity     INTEGER NOT NULL DEFAULT 4  CHECK (capacity > 0),

  -- Denormalised seat counter. Incremented/decremented ONLY by the atomic
  -- conditional UPDATE in the booking service. Counting rows instead would
  -- reintroduce the read-then-write race this whole repo exists to prevent.
  seats_taken  INTEGER NOT NULL DEFAULT 0,

  price_cents  INTEGER NOT NULL DEFAULT 5000 CHECK (price_cents > 0),
  currency     TEXT NOT NULL DEFAULT 'SGD',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- INVARIANT 1: a trial class can never be overbooked. Even a bug in the
  -- application cannot produce a 5-seat trial class; the transaction aborts.
  CONSTRAINT trial_classes_seats_within_capacity
    CHECK (seats_taken >= 0 AND seats_taken <= capacity),

  CONSTRAINT trial_classes_time_valid CHECK (ends_at > starts_at)
);


CREATE TABLE bookings (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  student_id       TEXT NOT NULL REFERENCES students(id),
  trial_class_id   TEXT NOT NULL REFERENCES trial_classes(id),
  status           booking_status NOT NULL DEFAULT 'pending_payment',

  -- Set while the booking holds a seat awaiting payment; NULL once terminal.
  hold_expires_at  TIMESTAMPTZ,
  confirmed_at     TIMESTAMPTZ,
  cancelled_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A seat held for payment must have an expiry, or an abandoned checkout
  -- would strand the seat forever and the sweeper would never find it.
  CONSTRAINT bookings_hold_required
    CHECK (status <> 'pending_payment' OR hold_expires_at IS NOT NULL),

  CONSTRAINT bookings_confirmed_at_set
    CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL)
);

-- INVARIANT 2: one child cannot hold two live bookings for the same class.
-- Partial on purpose — failed/expired/cancelled rows are kept for audit and
-- must NOT block a legitimate retry by the same parent.
CREATE UNIQUE INDEX bookings_one_active_per_student_class
  ON bookings (student_id, trial_class_id)
  WHERE status IN ('pending_payment', 'confirmed');

-- Roster reads and the hold sweeper.
CREATE INDEX bookings_class_status_idx ON bookings (trial_class_id, status);
CREATE INDEX bookings_hold_expiry_idx  ON bookings (hold_expires_at)
  WHERE status = 'pending_payment';


CREATE TABLE payment_attempts (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  booking_id      TEXT NOT NULL REFERENCES bookings(id),

  -- INVARIANT 3: a retried request is the SAME request. The provider mock and
  -- the webhook handler both key off this, so a duplicate submit or a replayed
  -- webhook can never produce a second charge.
  idempotency_key TEXT NOT NULL UNIQUE,

  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  currency        TEXT NOT NULL DEFAULT 'SGD',
  status          payment_status NOT NULL,
  card_token      TEXT,
  provider_ref    TEXT,
  failure_code    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payment_attempts_booking_idx ON payment_attempts (booking_id);


-- ---------------------------------------------------------------------------
-- updated_at maintenance. In the DB rather than the app so that a hand-written
-- SQL fix during a demo cannot silently leave a stale timestamp behind.
-- ---------------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_set_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER payment_attempts_set_updated_at
  BEFORE UPDATE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- Invariant sweep. The test suite asserts every row of this view after every
-- test, and a reviewer can run it by hand at any time:
--
--   SELECT * FROM class_seat_audit WHERE NOT ok;   -- must always be empty
--
-- It catches both failure modes: an overbooked class, and a seats_taken
-- counter that has drifted away from the bookings actually holding a seat.
-- ---------------------------------------------------------------------------
CREATE VIEW class_seat_audit AS
SELECT
  tc.id                AS trial_class_id,
  tc.capacity,
  tc.seats_taken,
  COUNT(b.id) FILTER (
    WHERE b.status IN ('pending_payment', 'confirmed')
  )::int               AS seat_holding_bookings,
  COUNT(b.id) FILTER (WHERE b.status = 'confirmed')::int AS confirmed_bookings,
  (
    tc.seats_taken <= tc.capacity
    AND COUNT(b.id) FILTER (WHERE b.status = 'confirmed') <= tc.capacity
    AND tc.seats_taken = COUNT(b.id) FILTER (
      WHERE b.status IN ('pending_payment', 'confirmed')
    )
  )                    AS ok
FROM trial_classes tc
LEFT JOIN bookings b ON b.trial_class_id = tc.id
GROUP BY tc.id, tc.capacity, tc.seats_taken;
