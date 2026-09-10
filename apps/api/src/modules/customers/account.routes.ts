import { Router } from "express";
import type { Db } from "@beautyai/db";
import { addressCreateSchema, addressUpdateSchema } from "@beautyai/shared";
import { validateBody } from "../../middleware/validate.js";
import { authenticateCustomer } from "../../middleware/customer.js";
import { ApiError } from "../../lib/http.js";
import type { AppConfig } from "../../config/env.js";
import {
  createAddress,
  deleteAddress,
  findCustomerById,
  listAddresses,
  listCustomers,
  toAddress,
  toCustomer,
  updateAddress,
  updateCustomer,
} from "../../repositories/customers.repo.js";
import { listOrdersByCustomer } from "../../repositories/orders.repo.js";

export function createCustomerAccountRouter(db: Db, config: AppConfig): Router {
  const meRouter = Router();
  meRouter.use(authenticateCustomer(db, config));

  meRouter.get("/account", async (req, res) => {
    const customer = await findCustomerById(db, req.cust!.tenantId, req.cust!.customerId);
    if (!customer) throw ApiError.notFound("Customer not found");
    res.json({ data: toCustomer(customer) });
  });

  meRouter.get("/orders", async (req, res) => {
    const tenantId = req.cust!.tenantId;
    const customerId = req.cust!.customerId;
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const { data, total } = await listOrdersByCustomer(db, tenantId, customerId, { page, limit });
    res.json({
      data: data.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        total_amount: o.total_amount,
        currency: o.currency,
        placed_at: o.placed_at.toISOString(),
      })),
      meta: { page, limit, total },
    });
  });

  meRouter.get("/addresses", async (req, res) => {
    const tenantId = req.cust!.tenantId;
    const rows = await listAddresses(db, tenantId, req.cust!.customerId);
    res.json({ data: rows.map(toAddress) });
  });

  meRouter.post("/addresses", validateBody(addressCreateSchema), async (req, res) => {
    const tenantId = req.cust!.tenantId;
    const row = await createAddress(db, tenantId, req.cust!.customerId, req.body);
    res.status(201).json({ data: toAddress(row) });
  });

  meRouter.patch("/addresses/:id", validateBody(addressUpdateSchema), async (req, res) => {
    const tenantId = req.cust!.tenantId;
    const row = await updateAddress(db, tenantId, req.cust!.customerId, String(req.params.id), req.body);
    res.json({ data: toAddress(row) });
  });

  meRouter.delete("/addresses/:id", async (req, res) => {
    const tenantId = req.cust!.tenantId;
    await deleteAddress(db, tenantId, req.cust!.customerId, String(req.params.id));
    res.status(204).end();
  });

  return meRouter;
}

export function createCustomerAdminRouter(db: Db): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 25);
    const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : undefined;
    const { data, total } = await listCustomers(db, req.ctx!.tenantId, { q, page, limit });
    res.json({ data: data.map(toCustomer), meta: { page, limit, total } });
  });

  router.get("/:id", async (req, res) => {
    const tenantId = req.ctx!.tenantId;
    const customer = await findCustomerById(db, tenantId, String(req.params.id));
    if (!customer) throw ApiError.notFound("Customer not found");
    const addresses = await listAddresses(db, tenantId, customer.id);
    res.json({ data: { ...toCustomer(customer), addresses: addresses.map(toAddress) } });
  });

  router.patch("/:id", async (req, res) => {
    const tenantId = req.ctx!.tenantId;
    const customer = await findCustomerById(db, tenantId, String(req.params.id));
    if (!customer) throw ApiError.notFound("Customer not found");
    const updated = await updateCustomer(db, tenantId, customer.id, {
      firstName: req.body?.firstName ?? undefined,
      lastName: req.body?.lastName ?? undefined,
      phone: req.body?.phone ?? undefined,
      notes: req.body?.notes ?? undefined,
      tags: req.body?.tags ?? undefined,
    });
    res.json({ data: toCustomer(updated) });
  });

  return router;
}