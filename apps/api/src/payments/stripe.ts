import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { ApiError } from "../lib/http.js";

export interface CheckoutLineItem {
  name: string;
  quantity: number;
  unitAmountCents: number;
}

export interface CreateSessionInput {
  tenantId: string;
  cartId: string;
  orderNumber: number | null;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
  lineItems: CheckoutLineItem[];
  currency: string;
  metadata: Record<string, string>;
}

export interface Payments {
  createCheckoutSession(input: CreateSessionInput): Promise<{ id: string; url: string | null }>;
  constructWebhookEvent(payload: string, signature: string): Stripe.Event;
  refundCharge(paymentIntentId: string, amountCents?: number): Promise<void>;
}

export function createStripeClient(secretKey: string, apiVersion: string = "2024-06-20"): Stripe {
  return new Stripe(secretKey, { apiVersion: apiVersion as Stripe.StripeConfig["apiVersion"] });
}

function requireClient(stripe: Stripe | null): Stripe {
  if (!stripe) throw ApiError.serviceUnavailable("Stripe is not configured (STRIPE_SECRET_KEY missing)");
  return stripe;
}

export function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  webhookSecret: string,
  toleranceSec = 300,
): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",").map((p) => p.trim());
  let timestamp = "";
  const signatures = new Map<string, string>();
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.set(key, value);
  }
  if (!timestamp || !signatures.has("v1")) return false;
  const expected = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const received = signatures.get("v1")!;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  return ageSec <= toleranceSec;
}

export function createPayments(
  secretKey: string | undefined,
  webhookSecret: string | undefined,
  apiVersion: string = "2024-06-20",
): Payments {
  const stripe = secretKey ? new Stripe(secretKey, { apiVersion: apiVersion as Stripe.StripeConfig["apiVersion"] }) : null;

  return {
    async createCheckoutSession(input) {
      const client = requireClient(stripe);
      const session = await client.checkout.sessions.create({
        mode: "payment",
        customer_email: input.customerEmail ?? undefined,
        client_reference_id: input.cartId,
        currency: input.currency.toLowerCase(),
        line_items: input.lineItems.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: item.unitAmountCents,
            product_data: { name: item.name },
          },
        })),
        metadata: {
          tenant_id: input.tenantId,
          cart_id: input.cartId,
          ...input.metadata,
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      return { id: session.id, url: session.url };
    },

    constructWebhookEvent(payload, signature) {
      if (!webhookSecret) {
        throw ApiError.serviceUnavailable("Stripe webhook secret is not configured (STRIPE_WEBHOOK_SECRET missing)");
      }
      if (!verifyStripeSignature(payload, signature, webhookSecret)) {
        throw new ApiError(400, "Invalid Signature", "Stripe webhook signature verification failed");
      }
      return JSON.parse(payload) as Stripe.Event;
    },

    async refundCharge(paymentIntentId, amountCents) {
      await requireClient(stripe).refunds.create({
        payment_intent: paymentIntentId,
        ...(amountCents ? { amount: amountCents } : {}),
      });
    },
  };
}