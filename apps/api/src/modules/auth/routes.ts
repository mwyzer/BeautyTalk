import { Router } from "express";
import { loginSchema, refreshSchema, registerSchema } from "@beautyai/shared";
import { validateBody } from "../../middleware/validate.js";
import type { AuthService } from "./service.js";

export function createAuthRouter(auth: AuthService): Router {
  const router = Router();

  router.post("/register", validateBody(registerSchema), async (req, res) => {
    const result = await auth.register(req.body, req.ip);
    res.status(201).json(result);
  });

  router.post("/login", validateBody(loginSchema), async (req, res) => {
    const result = await auth.login(req.body, req.ip);
    res.json(result);
  });

  router.post("/refresh", validateBody(refreshSchema), async (req, res) => {
    const tokens = await auth.refresh(req.body.refreshToken, req.ip);
    res.json(tokens);
  });

  router.post("/logout", validateBody(refreshSchema), async (req, res) => {
    await auth.logout(req.body.refreshToken, false);
    res.status(204).end();
  });

  router.post("/logout-all", validateBody(refreshSchema), async (req, res) => {
    await auth.logout(req.body.refreshToken, true);
    res.status(204).end();
  });

  return router;
}