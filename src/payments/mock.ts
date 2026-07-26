import { config } from "../config.js";
import {
  ProviderTimeout,
  type Authorization,
  type AuthorizeInput,
  type Capture,
  type PaymentProvider,
} from "./provider.js";

/**
 * Deterministic mock provider.
 *
 * Faithful to the STATE MACHINE and IDEMPOTENCY semantics of a real PSP, and
 * deliberately unfaithful to everything about money movement. Good enough to
 * prove the booking invariants; not good enough to take a payment.
 *
 * Card tokens mirror Stripe's test-card convention so the behaviour is
 * guessable by anyone who has integrated a real provider.
 */
export const CARD_TOKENS = {
  ok: "tok_ok",
  declined: "tok_fail_declined",
  insufficientFunds: "tok_fail_funds",
  /** Authorizes successfully, then the response is lost. The nastiest case. */
  timeout: "tok_timeout",
} as const;

type AuthRecord = {
  id: string;
  status: "authorized" | "captured" | "voided" | "failed";
  amountCents: number;
  failureCode?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockPaymentProvider implements PaymentProvider {
  private readonly auths = new Map<string, AuthRecord>();
  /** idempotencyKey -> the response we already gave for it. */
  private readonly replies = new Map<string, Authorization>();
  private seq = 0;

  /** Test hook: what the provider was actually asked to do, in order. */
  readonly calls: Array<{ op: string; ref: string }> = [];

  async authorize(input: AuthorizeInput): Promise<Authorization> {
    if (config.payment.latencyMs > 0) await sleep(config.payment.latencyMs);

    // Idempotency: a replayed request is the SAME request. It returns the
    // original answer and does NOT create a second authorization.
    const prior = this.replies.get(input.idempotencyKey);
    if (prior) {
      this.calls.push({ op: "authorize:replay", ref: prior.id });
      return prior;
    }

    const id = `pi_mock_${++this.seq}`;
    this.calls.push({ op: "authorize", ref: id });

    const declineCode =
      input.cardToken === CARD_TOKENS.declined
        ? "card_declined"
        : input.cardToken === CARD_TOKENS.insufficientFunds
          ? "insufficient_funds"
          : null;

    if (declineCode) {
      const result: Authorization = {
        id,
        status: "failed",
        failureCode: declineCode,
      };
      this.auths.set(id, {
        id,
        status: "failed",
        amountCents: input.amountCents,
        failureCode: declineCode,
      });
      this.replies.set(input.idempotencyKey, result);
      return result;
    }

    const result: Authorization = { id, status: "authorized" };
    this.auths.set(id, {
      id,
      status: "authorized",
      amountCents: input.amountCents,
    });
    // Recorded BEFORE the timeout below, that is the whole point: the charge
    // landed even though the caller never heard back. A retry with the same
    // idempotency key must find this, not create a second authorization.
    this.replies.set(input.idempotencyKey, result);

    if (input.cardToken === CARD_TOKENS.timeout) {
      throw new ProviderTimeout(input.idempotencyKey);
    }
    return result;
  }

  async capture(authId: string, _idempotencyKey: string): Promise<Capture> {
    this.calls.push({ op: "capture", ref: authId });
    const auth = this.auths.get(authId);
    if (!auth) throw new Error(`unknown authorization ${authId}`);
    if (auth.status === "captured") return { id: authId, status: "captured" };
    if (auth.status !== "authorized") {
      // A real provider refuses this too. Being permissive here would let the
      // application depend on behaviour production would not give it.
      throw new Error(`cannot capture an authorization that is ${auth.status}`);
    }
    auth.status = "captured";
    return { id: authId, status: "captured" };
  }

  async voidAuth(authId: string): Promise<void> {
    this.calls.push({ op: "void", ref: authId });
    const auth = this.auths.get(authId);
    if (!auth) throw new Error(`unknown authorization ${authId}`);
    if (auth.status === "captured") {
      throw new Error("cannot void an authorization that was already captured");
    }
    auth.status = "voided";
  }

  // ---- test helpers ----
  statusOf(authId: string): string | undefined {
    return this.auths.get(authId)?.status;
  }

  captureCount(): number {
    return this.calls.filter((c) => c.op === "capture").length;
  }

  reset(): void {
    this.auths.clear();
    this.replies.clear();
    this.calls.length = 0;
    this.seq = 0;
  }
}

/**
 * One provider instance per SERVER, not per module bundle.
 *
 * Next compiles each route into its own bundle, so a plain module-level
 * `new MockPaymentProvider()` gives /authorize and /capture separate copies of
 * the authorization map, capture then cannot find what authorize just stored.
 * Pinning to globalThis also survives dev hot-reloads.
 *
 * A real PSP keeps this state on their side; the mock has to keep it on ours.
 */
const globalRef = globalThis as unknown as {
  __ottodotMockProvider?: MockPaymentProvider;
};

export const mockProvider =
  globalRef.__ottodotMockProvider ??
  (globalRef.__ottodotMockProvider = new MockPaymentProvider());
