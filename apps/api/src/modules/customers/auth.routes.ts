import { Router } from "express";
import type { Db } from "@beautyai/db";
import { customerLoginSchema, customerRegisterSchema } from "@beautyai/shared";
import { validateBody } from "../../middleware/validate.js";
import { resolveTenant } from "../../middleware/tenant.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import type { CustomerAuthService } from "./service.js";

const CUSTOMER_AUTH_RATE = rateLimit({ windowMs: 60_000, max: 10 });

export function createCustomerAuthRouter(db: Db, auth: CustomerAuthService): Router {
  const router = Router();
  router.use(resolveTenant(db));

  router.post("/register", CUSTOMER_AUTH_RATE, validateBody(customerRegisterSchema), async (req, res) => {
    const result = await auth.register(req.tenant!.id, req.body, req.ip);
    res.status(201).json({ data: result });
  });

  router.post("/login", CUSTOMER_AUTH_RATE, validateBody(customerLoginSchema), async (req, res) => {
    const result = await auth.login(req.tenant!.id, req.body, req.ip);
    res.json({ data: result });
  });

  return router;
}