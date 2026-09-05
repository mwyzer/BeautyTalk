import { Router } from "express";
import type { AppConfig } from "../../config/env.js";
import type { Payments } from "../../payments/stripe.js";
import { ApiError } from "../../lib/http.js";
import type { CheckoutService } from "./service.js";

export function createStripeWebhookRouter(checkout: CheckoutService, payments: Payments, _config: AppConfig): Router {
  const router = Router();

  router.post("/stripe", async (req, res) => {
    const payload = (req.body as Buffer).toString("utf8");
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      res.status(400).json({ error: "Missing Stripe-Signature header" });
      return;
    }

    let event;
    try {
      event = payments.constructWebhookEvent(payload, signature);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("[webhook] signature error", err);
      res.status(500).json({ error: "Internal webhook error" });
      return;
    }

    try {
      if (event.type === "checkout.session.completed") {
        await checkout.handleCheckoutCompleted(event);
      } else {
        console.info("[webhook] unhandled event type", { type: event.type });
      }
      res.json({ received: true });
    } catch (err) {
      console.error("[webhook] processing error", err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  return router;
}