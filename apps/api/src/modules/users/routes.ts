import { Router } from "express";
import type { Db } from "@beautyai/db";
import { ApiError } from "../../lib/http.js";
import { listMembersByTenant } from "../../repositories/memberships.repo.js";

export function createAdminUsersRouter(db: Db): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const members = await listMembersByTenant(db, req.ctx!.tenantId);
    res.json({ data: members });
  });

  // Tenant-scoped lookup: cross-tenant user ids resolve to 404 (no enumeration).
  router.get("/:userId", async (req, res) => {
    const userId = req.params.userId;
    const members = await listMembersByTenant(db, req.ctx!.tenantId);
    const member = members.find((m) => m.userId === userId);
    if (!member) throw ApiError.notFound("User not found in this store");
    res.json({ data: member });
  });

  return router;
}