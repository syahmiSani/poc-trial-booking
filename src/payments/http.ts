import { config } from "../config.js";
import {
  ProviderTimeout,
  type Authorization,
  type AuthorizeInput,
  type Capture,
  type PaymentProvider,
} from "./provider.js";

/**
 * Talks to the mock provider over REST.
 *
 * This is what the web flow uses. Going over HTTP rather than importing the
 * mock directly buys real fidelity: a genuine network boundary, real JSON
 * serialisation, and a real chance for a response to be lost — which is the
 * failure mode the idempotency design exists for.
 *
 * The unit tests use the in-process mock instead, because they need to assert
 * on the exact provider call sequence.
 */
export class HttpPaymentProvider implements PaymentProvider {
  constructor(private readonly baseUrl: string = config.payment.providerUrl) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) {
      if (json.error === "PROVIDER_TIMEOUT") {
        throw new ProviderTimeout(String((body as { idempotencyKey: string }).idempotencyKey));
      }
      throw new Error(json.error ?? `provider returned ${res.status}`);
    }
    return json;
  }

  authorize(input: AuthorizeInput): Promise<Authorization> {
    return this.post<Authorization>("authorize", input);
  }

  capture(authId: string, idempotencyKey: string): Promise<Capture> {
    return this.post<Capture>("capture", { authId, idempotencyKey });
  }

  async voidAuth(authId: string): Promise<void> {
    await this.post("void", { authId });
  }
}
