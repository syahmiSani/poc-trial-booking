-- ===========================================================================
-- Synthetic seed data.
--
-- Every fixture below exists to demonstrate one specific case from the brief.
-- Re-runnable: truncates first, so `npm run db:reset` is always deterministic.
--
--   TC-101  Science P4  1/4 confirmed  -> a class with available seats
--                                      -> Aiden is already on it (duplicate case)
--   TC-102  Math P5     3/4 confirmed  -> EXACTLY 3, the last-seat race target
--   TC-103  Math P3     4/4 confirmed  -> a full class, selection must be refused
--   TC-104  Science P6  1/4 held       -> an EXPIRED hold (sweeper target)
--                                      -> plus a payment_failed booking that
--                                         correctly holds no seat
--
-- Mock card tokens (mirrors Stripe's test-card convention):
--   tok_ok              -> authorizes and captures
--   tok_fail_declined   -> declined at authorize
--   tok_fail_funds      -> declined, insufficient_funds
--   tok_timeout         -> provider timeout: charge landed, response lost
-- ===========================================================================

TRUNCATE payment_attempts, bookings, trial_classes, students, parents CASCADE;

-- ---------------------------------------------------------------------------
-- Parents and their children
-- ---------------------------------------------------------------------------
INSERT INTO parents (id, name, email) VALUES
  ('P-1', 'Siti Rahman',  'siti.rahman@example.com'),
  ('P-2', 'Tan Wei Ling', 'wei.tan@example.com'),
  ('P-3', 'Kumar Raj',    'kumar.raj@example.com'),
  ('P-4', 'Nurul Aziz',   'nurul.aziz@example.com');

INSERT INTO students (id, parent_id, name, level) VALUES
  ('S-1',  'P-1', 'Aiden',  'P4'),
  ('S-2',  'P-1', 'Bella',  'P6'),
  ('S-3',  'P-2', 'Chloe',  'P5'),
  ('S-4',  'P-3', 'Darren', 'P5'),
  ('S-5',  'P-3', 'Ethan',  'P5'),
  ('S-6',  'P-4', 'Faris',  'P3'),
  ('S-7',  'P-4', 'Gina',   'P3'),
  ('S-8',  'P-4', 'Hakim',  'P3'),
  ('S-9',  'P-4', 'Iris',   'P3'),
  -- Two named unbooked P5 children, used as Parent A and Parent B in the
  -- readable two-party race demo.
  ('S-10', 'P-2', 'Jonas',  'P5'),
  ('S-11', 'P-3', 'Kaya',   'P5'),
  -- An unbooked P6 child, for the expired-hold fixture on TC-104.
  ('S-12', 'P-4', 'Liam',   'P6'),
  -- An unbooked P3 child, so "book a full class" can be tested WITHOUT
  -- tripping the duplicate rule first, otherwise that test passes for the
  -- wrong reason.
  ('S-13', 'P-4', 'Mira',   'P3');

-- Twenty unbooked P5 children (R-1 .. R-20). These are the contenders in the
-- last-seat race on TC-102: twenty DISTINCT children competing for one seat,
-- so the winner is decided by seat scarcity and not by the duplicate-booking
-- index quietly rejecting most of the field.
INSERT INTO students (id, parent_id, name, level)
SELECT 'R-' || i, 'P-' || (1 + (i % 4)), 'Racer ' || i, 'P5'
  FROM generate_series(1, 20) AS i;

-- ---------------------------------------------------------------------------
-- Trial classes. seats_taken is set explicitly here to match the bookings
-- inserted below; from this point on ONLY the booking service may change it.
-- ---------------------------------------------------------------------------
INSERT INTO trial_classes
  (id, subject, level, starts_at, ends_at, teacher_name, capacity, seats_taken) VALUES
  ('TC-101', 'science', 'P4',
   '2026-08-01 10:00+08', '2026-08-01 11:15+08', 'Ms Lim',   4, 1),
  ('TC-102', 'math',    'P5',
   '2026-08-01 11:30+08', '2026-08-01 12:45+08', 'Mr Tan',   4, 3),
  ('TC-103', 'math',    'P3',
   '2026-08-02 09:30+08', '2026-08-02 10:45+08', 'Ms Devi',  4, 4),
  ('TC-104', 'science', 'P6',
   '2026-08-01 14:00+08', '2026-08-01 15:15+08', 'Mr Chua',  4, 1);

-- A fuller weekly schedule so the booking page looks like a real timetable
-- rather than a fixture. These carry no special state, every one of them is
-- simply open. The four above remain the ones the tests and demos rely on.
INSERT INTO trial_classes
  (id, subject, level, starts_at, ends_at, teacher_name, capacity, seats_taken)
VALUES
  -- Weekday evenings (Ottodot runs 15:00 to 20:30 on weekdays)
  ('TC-105', 'math',    'P1', '2026-07-27 16:00+08', '2026-07-27 17:15+08', 'Ms Lim',   4, 0),
  ('TC-106', 'science', 'P2', '2026-07-27 17:30+08', '2026-07-27 18:45+08', 'Mr Chua',  4, 0),
  ('TC-107', 'math',    'P4', '2026-07-28 17:30+08', '2026-07-28 18:45+08', 'Mr Tan',   4, 0),
  ('TC-108', 'science', 'P5', '2026-07-28 19:00+08', '2026-07-28 20:15+08', 'Ms Devi',  4, 0),
  ('TC-109', 'math',    'P3', '2026-07-29 16:00+08', '2026-07-29 17:15+08', 'Ms Devi',  4, 0),
  ('TC-110', 'science', 'P4', '2026-07-29 17:30+08', '2026-07-29 18:45+08', 'Ms Lim',   4, 0),
  ('TC-111', 'math',    'P6', '2026-07-30 19:00+08', '2026-07-30 20:15+08', 'Mr Tan',   4, 0),
  ('TC-112', 'science', 'P3', '2026-07-31 16:00+08', '2026-07-31 17:15+08', 'Mr Chua',  4, 0),
  -- Weekends (09:30 to 18:00)
  ('TC-113', 'math',    'P2', '2026-08-01 09:30+08', '2026-08-01 10:45+08', 'Ms Lim',   4, 0),
  ('TC-114', 'science', 'P1', '2026-08-01 16:00+08', '2026-08-01 17:15+08', 'Ms Devi',  4, 0),
  ('TC-115', 'math',    'P5', '2026-08-02 11:00+08', '2026-08-02 12:15+08', 'Mr Tan',   4, 0),
  ('TC-116', 'science', 'P6', '2026-08-02 14:00+08', '2026-08-02 15:15+08', 'Mr Chua',  4, 0);

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

-- TC-101, one confirmed child. Booking Aiden onto TC-101 again must be
-- rejected by the partial unique index, not by application code.
INSERT INTO bookings (id, student_id, trial_class_id, status, confirmed_at) VALUES
  ('B-101', 'S-1', 'TC-101', 'confirmed', '2026-07-20 09:14+08');

-- TC-102, exactly three confirmed. One seat left. This is the race target.
INSERT INTO bookings (id, student_id, trial_class_id, status, confirmed_at) VALUES
  ('B-102', 'S-3', 'TC-102', 'confirmed', '2026-07-18 20:02+08'),
  ('B-103', 'S-4', 'TC-102', 'confirmed', '2026-07-19 08:47+08'),
  ('B-104', 'S-5', 'TC-102', 'confirmed', '2026-07-21 21:33+08');

-- TC-103, full.
INSERT INTO bookings (id, student_id, trial_class_id, status, confirmed_at) VALUES
  ('B-105', 'S-6', 'TC-103', 'confirmed', '2026-07-15 10:05+08'),
  ('B-106', 'S-7', 'TC-103', 'confirmed', '2026-07-15 10:06+08'),
  ('B-107', 'S-8', 'TC-103', 'confirmed', '2026-07-16 19:20+08'),
  ('B-108', 'S-9', 'TC-103', 'confirmed', '2026-07-17 11:41+08');

-- TC-104, a payment that failed. It holds NO seat and must never appear on
-- the roster, which is exactly the case the brief asks to see handled.
INSERT INTO bookings (id, student_id, trial_class_id, status, cancelled_reason) VALUES
  ('B-109', 'S-2', 'TC-104', 'payment_failed', 'card_declined');

-- TC-104, a hold that has ALREADY expired. It still occupies seats_taken, so
-- running the sweeper visibly returns the seat: 1/4 -> 0/4.
INSERT INTO bookings (id, student_id, trial_class_id, status, hold_expires_at) VALUES
  ('B-110', 'S-12', 'TC-104', 'pending_payment', now() - interval '5 minutes');

-- ---------------------------------------------------------------------------
-- Payment attempts, the audit trail behind the bookings above.
-- ---------------------------------------------------------------------------
INSERT INTO payment_attempts
  (id, booking_id, idempotency_key, amount_cents, status, card_token, provider_ref, failure_code) VALUES
  ('PA-1', 'B-101', 'seed-b101', 5000, 'captured', 'tok_ok', 'pi_seed_101', NULL),
  ('PA-2', 'B-102', 'seed-b102', 5000, 'captured', 'tok_ok', 'pi_seed_102', NULL),
  ('PA-3', 'B-103', 'seed-b103', 5000, 'captured', 'tok_ok', 'pi_seed_103', NULL),
  ('PA-4', 'B-104', 'seed-b104', 5000, 'captured', 'tok_ok', 'pi_seed_104', NULL),
  -- The failed one: authorize was declined, so no capture ever happened and
  -- no seat was ever taken.
  ('PA-5', 'B-109', 'seed-b109', 5000, 'failed', 'tok_fail_declined', NULL, 'card_declined');
