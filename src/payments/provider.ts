/**
 * The payment provider contract.
 *
 * Deliberately shaped like Stripe PaymentIntents with manual capture, so
 * swapping the mock for the real thing is one adapter file:
 *
 *   authorize -> paymentIntents.create({ capture_method: 'manual' })
 *   capture   -> paymentIntents.capture()
 *   voidAuth  -> paymentIntents.cancel()
 *
 * The tests are written against THIS interface, not against the mock, so the
 * same suite could be pointed at Stripe test mode unchanged.
 */

export type AuthorizeInput = {
  amountCents: number;
  currency: string;
  cardToken: string;
  idempotencyKey: string;
};

export type Authorization = {
  id: string;
  status: "authorized" | "failed";
  failureCode?: string;
};

export type Capture = { id: string; status: "captured" };

export interface PaymentProvider {
  authorize(input: AuthorizeInput): Promise<Authorization>;
  capture(authId: string, idempotencyKey: string): Promise<Capture>;
  voidAuth(authId: string): Promise<void>;
}

/** Thrown when the provider's answer never arrived, the charge may exist. */
export class ProviderTimeout extends Error {
  constructor(readonly idempotencyKey: string) {
    super("payment provider timed out; outcome unknown");
    this.name = "ProviderTimeout";
  }
}
