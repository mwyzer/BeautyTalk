import { Router } from "express";
import type { Db } from "@beautyai/db";
import { z } from "zod";
import { resolveTenant } from "../../middleware/tenant.js";
import { ApiError } from "../../lib/http.js";
import type { CheckoutService } from "./service.js";

const checkoutSessionSchema = z.object({
  cartId: z.string().uuid("cartId must be a valid id"),
});

export function createCheckoutRouter(db: Db, checkout: CheckoutService): Router {
  const router = Router();

  router.post("/sessions", resolveTenant(db), async (req, res) => {
    const parsed = checkoutSessionSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.validation("Invalid checkout payload");
    const result = await checkout.createSession(req.tenant!.id, parsed.data.cartId);
    res.status(201).json({ data: result });
  });

  router.get("/confirm/:sessionId", resolveTenant(db), async (req, res) => {
    const result = await checkout.confirmSession(req.tenant!.id, String(req.params.sessionId));
    res.json({ data: result });
  });

  return router;
}