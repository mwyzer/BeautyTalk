import type Stripe from "stripe";
import type { DbPool } from "@beautyai/db";
import type { CheckoutResult, Order } from "@beautyai/shared";
import { ApiError } from "../../lib/http.js";
import type { AppConfig } from "../../config/env.js";
import type { Payments } from "../../payments/stripe.js";
import { loadCart, markCartConverted } from "../../repositories/carts.repo.js";
import { bumpCustomerTotals } from "../../repositories/customers.repo.js";
import { createOrder, findOrderBySession, loadOrderDetail } from "../../repositories/orders.repo.js";

export interface CheckoutService {
  createSession(tenantId: string, cartId: string): Promise<CheckoutResult>;
  confirmSession(tenantId: string, sessionId: string): Promise<{ status: string; order?: ReturnType<typeof summarizeOrder> }>;
  handleCheckoutCompleted(event: Stripe.Event): Promise<void>;
}

function summarizeOrder(order: Order): { id: string; number: number; status: Order["status"]; totalAmount: number; currency: string } {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    totalAmount: order.totalAmount,
    currency: order.currency,
  };
}

export function createCheckoutService(db: DbPool, payments: Payments, config: AppConfig): CheckoutService {
  return {
    async createSession(tenantId, cartId) {
      const cart = await loadCart(db, tenantId, cartId);
      if (!cart) throw ApiError.notFound("Cart not found");
      if (cart.items.length === 0) throw ApiError.badRequest("Cart is empty");
      if (!config.CHECKOUT_SUCCESS_URL || !config.CHECKOUT_CANCEL_URL) {
        throw ApiError.serviceUnavailable("Checkout URLs are not configured");
      }
      const session = await payments.createCheckoutSession({
        tenantId,
        cartId: cart.id,
        orderNumber: null,
        customerEmail: null,
        successUrl: config.CHECKOUT_SUCCESS_URL,
        cancelUrl: config.CHECKOUT_CANCEL_URL,
        currency: "usd",
        metadata: {},
        lineItems: cart.items.map((i) => ({
          name: `${i.productTitle} — ${i.variantTitle}`,
          quantity: i.quantity,
          unitAmountCents: i.unitPriceAmount,
        })),
      });
      return { sessionId: session.id, sessionUrl: session.url, cartId: cart.id, orderNumber: null };
    },

    async confirmSession(tenantId, sessionId) {
      const order = await findOrderBySession(db, tenantId, sessionId);
      if (!order) return { status: "pending" };
      const detail = await loadOrderDetail(db, tenantId, order);
      return { status: "complete", order: summarizeOrder(detail) };
    },

    async handleCheckoutCompleted(event) {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.metadata?.tenant_id;
      const cartId = session.client_reference_id || session.metadata?.cart_id;
      if (!tenantId || !cartId) {
        console.warn("[webhook] checkout.session.completed missing metadata", { sessionId: session.id });
        return;
      }
      const existing = await findOrderBySession(db, tenantId, session.id);
      if (existing) return; // idempotent

      const cart = await loadCart(db, tenantId, cartId);
      if (!cart || cart.items.length === 0) {
        console.warn("[webhook] cart not found or empty", { tenantId, cartId, sessionId: session.id });
        return;
      }

      const customerEmail = session.customer_details?.email ?? session.customer_email ?? null;
      const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const order = await createOrder(client, tenantId, {
          tenantId,
          customerId: cart.customerId,
          cartId: cart.id,
          email: customerEmail,
          stripeSessionId: session.id,
          stripePaymentIntent: paymentIntent,
          items: cart.items.map((i) => ({
            variantId: i.variantId,
            productTitle: i.productTitle,
            variantTitle: i.variantTitle,
            sku: i.sku,
            unitPriceAmount: i.unitPriceAmount,
            quantity: i.quantity,
          })),
          subtotalAmount: cart.subtotalAmount,
          shippingAmount: 0,
          taxAmount: 0,
        });
        await markCartConverted(client, tenantId, cart.id);
        if (cart.customerId) {
          await bumpCustomerTotals(client, tenantId, cart.customerId, order.total_amount);
        }
        await client.query("COMMIT");
        console.info("[webhook] order created", { tenantId, order: order.id, number: order.number, sessionId: session.id });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}