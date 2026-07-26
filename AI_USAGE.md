# AI usage

## Tools

**Claude Opus (Claude Code)** as a pair, driving from a terminal with access to
the repo, Docker and Postgres. Everything below was verified by running it, not
by reading it and nodding.

## What I used it for

- Scaffolding: `package.json`, tsconfig, Vitest config, docker-compose.
- Writing the SQL schema and seed from a design I had already settled on.
- The concurrency test harness — barriers, twenty parallel connections,
  bucketing settled promises. Fiddly, mechanical, and exactly the kind of code
  worth delegating.
- The seven diagrams in `docs/`, generated from a layout script so the `.drawio`
  source and the rendered PNGs come from identical geometry.
- First drafts of this file and the README.

## Where AI moved me faster

The 20-child race harness. Writing code that reliably puts twenty database
transactions in flight *at the same instant*, then classifies each outcome into
won / cleanly-refused / crashed, is tedious to get right and easy to get subtly
wrong. Having it written in one pass meant I spent my time on whether the test
was **asking the right question** rather than on `Promise.allSettled` plumbing.

The diagrams are a close second. A validator that fails the build on text
overflow, overlapping shapes, or arrows crossing boxes is more code than the
diagrams themselves, and I would not have written it by hand inside a timebox.

## Where I disagreed with, corrected, or rejected AI output

Three real ones, all caught by running the code rather than reading it.

### 1. A test that passed for the wrong reason

The generated "rejects booking a full class" test booked a child who was
*already on that class*. It passed — but via `DUPLICATE_BOOKING`, so the
capacity check never ran at all. I added an unbooked P3 child to the seed
specifically so that test can only fail for the reason it claims to test.

### 2. The "naive" implementation was accidentally safe

The whole point of keeping a naive strategy is to show the same test going red
against the obvious wrong code. It kept passing. The generated version counted
bookings in `('pending_payment','confirmed')`, so each transaction saw **its
own** just-inserted row and correctly stopped.

The mistake people actually ship counts **confirmed only** — "how many children
are on the roster" is not the same question as "how many seats are gone." Once
corrected, naive fails exactly as it should: 19 of 20 requests blow up on the
`CHECK` constraint instead of being refused cleanly.

This one mattered most. A red/green comparison that is quietly green on both
sides is worse than no comparison, because it manufactures false confidence.

### 3. The race test was decided by scheduling luck

The first version raced twenty attempts across only *two* students, so eighteen
were rejected as duplicates and never reached the seat logic. The real contest
was 2-way, and the outcome depended on timing. I seeded twenty distinct children
and added a forced 200 ms window between the read and the write, so `safe` is
now proven against a **deliberately wide** race window rather than a lucky one.

### Also rejected

- **A singleton that wasn't.** The mock provider was a module-level instance.
  Next compiles each route into its own bundle, so `/authorize` and `/capture`
  got separate copies of the authorization map and capture 500'd. Found by
  running the flow over HTTP; fixed by pinning to `globalThis`.
- **Verbose commit messages.** Multi-paragraph, machine-sounding. Rewritten to
  one short subject line each.

## What I would change about my AI workflow

**Write the invariant test before asking for any implementation.** I did this
for the schema and it worked well — the constraints were verified against real
Postgres before a line of TypeScript existed. I did *not* do it for the naive
strategy, and the result was a test that agreed with whatever it was given.
Judging AI output by a test I wrote first is far more reliable than judging it
by how convincing the code reads, and convincing-looking code is precisely what
these tools are best at producing.

Second: I would put the diagrams and the schema in the same first pass. Drawing
the architecture forced decisions (reserve-at-selection, capture-after-confirm)
that would have been expensive to discover later in code.

## How I verified the final implementation

- `npm test` — 27 tests against real Postgres from a clean `db:reset`, including
  the 20-child race under **both** strategies.
- An invariant sweep over **every** class after **every** test, not just the one
  under test. It caught a real drift during development, when I bumped
  `seats_taken` by hand without a matching booking row.
- The full flow driven over REST with curl: book → duplicate refused → declined
  card → seat released → rebook → pay → roster.
- Two `psql` sessions by hand, confirming the blocked `UPDATE` re-evaluates its
  `WHERE` and takes no seat — the guarantee, demonstrated without any of my
  application code.
- The testing console at `/testing`, which reports winners, clean refusals and
  raw database errors side by side for safe vs naive.

Nothing in this repo is claimed as working on the strength of having been
written. Every claim in the README maps to something I ran.
