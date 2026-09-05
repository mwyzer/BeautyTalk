import { Router } from "express";
import type { DbPool } from "@beautyai/db";
import { fulfillOrderSchema, orderUpdateSchema, refundOrderSchema, type OrderStatus } from "@beautyai/shared";
import { validateBody } from "../../middleware/validate.js";
import { requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/http.js";
import type { Payments } from "../../payments/stripe.js";
import {
  createShipment,
  findOrderById,
  listOrders,
  loadOrderDetail,
  setOrderNotes,
  setOrderStatus,
} from "../../repositories/orders.repo.js";
import { writeAuditLog } from "../../repositories/audit-logs.repo.js";

const ORDER_STATUSES: OrderStatus[] = ["pending", "paid", "fulfilled", "shipped", "delivered", "cancelled", "refunded"];

export function createAdminOrdersRouter(db: DbPool, payments: Payments): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const tenantId = req.ctx!.tenantId;
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 25);
    const status = typeof req.query.status === "string" && ORDER_STATUSES.includes(req.query.status as OrderStatus)
      ? (req.query.status as OrderStatus)
      : undefined;
    const { data, total } = await listOrders(db, tenantId, { status, page, limit });
    res.json({
      data: data.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        email: o.email,
        total_amount: o.total_amount,
        currency: o.currency,
        placed_at: o.placed_at.toISOString(),
        item_count: undefined,
      })),
      meta: { page, limit, total },
    });
  });

  router.get("/:id", async (req, res) => {
    const tenantId = req.ctx!.tenantId;
    const order = await findOrderById(db, tenantId, String(req.params.id));
    if (!order) throw ApiError.notFound("Order not found");
    res.json({ data: await loadOrderDetail(db, tenantId, order) });
  });

  router.patch("/:id", validateBody(orderUpdateSchema), async (req, res) => {
    const ctx = req.ctx!;
    const order = await findOrderById(db, ctx.tenantId, String(req.params.id));
    if (!order) throw ApiError.notFound("Order not found");
    if (req.body.status !== undefined) {
      if (req.body.status !== order.status) {
        if (req.body.status === "refunded" || order.status === "refunded") {
          throw ApiError.conflict("Use the refund endpoint for refunds");
        }
        if (order.status === "cancelled" && req.body.status !== "cancelled") {
          throw ApiError.conflict("A cancelled order cannot change status");
        }
        await setOrderStatus(db, ctx.tenantId, order.id, req.body.status, ctx.userId);
      }
    }
    if (req.body.notes !== undefined) {
      await setOrderNotes(db, ctx.tenantId, order.id, req.body.notes);
    }
    const updated = await findOrderById(db, ctx.tenantId, order.id);
    res.json({ data: await loadOrderDetail(db, ctx.tenantId, updated!) });
  });

  router.post("/:id/fulfill", validateBody(fulfillOrderSchema), async (req, res) => {
    const ctx = req.ctx!;
    const order = await findOrderById(db, ctx.tenantId, String(req.params.id));
    if (!order) throw ApiError.notFound("Order not found");
    if (["cancelled", "refunded"].includes(order.status)) {
      throw ApiError.conflict(`Cannot fulfill a ${order.status} order`);
    }
    await createShipment(db, ctx.tenantId, order.id, {
      carrier: req.body.carrier,
      trackingNumber: req.body.trackingNumber ?? null,
    });
    await setOrderStatus(db, ctx.tenantId, order.id, "fulfilled", ctx.userId, {
      carrier: req.body.carrier,
      tracking: req.body.trackingNumber ?? null,
    });
    await writeAuditLog(db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "order.fulfill",
      resourceType: "order",
      resourceId: order.id,
      after: { carrier: req.body.carrier },
    });
    const updated = await findOrderById(db, ctx.tenantId, order.id);
    res.json({ data: await loadOrderDetail(db, ctx.tenantId, updated!) });
  });

  router.post("/:id/cancel", async (req, res) => {
    const ctx = req.ctx!;
    const order = await findOrderById(db, ctx.tenantId, String(req.params.id));
    if (!order) throw ApiError.notFound("Order not found");
    if (["cancelled", "refunded", "delivered"].includes(order.status)) {
      throw ApiError.conflict(`Cannot cancel a ${order.status} order`);
    }
    await setOrderStatus(db, ctx.tenantId, order.id, "cancelled", ctx.userId, { reason: req.body?.reason ?? null });
    await writeAuditLog(db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "order.cancel",
      resourceType: "order",
      resourceId: order.id,
    });
    const updated = await findOrderById(db, ctx.tenantId, order.id);
    res.json({ data: await loadOrderDetail(db, ctx.tenantId, updated!) });
  });

  router.post("/:id/refund", requireRoles("owner"), validateBody(refundOrderSchema), async (req, res) => {
    const ctx = req.ctx!;
    const order = await findOrderById(db, ctx.tenantId, String(req.params.id));
    if (!order) throw ApiError.notFound("Order not found");
    if (["cancelled", "refunded"].includes(order.status)) {
      throw ApiError.conflict(`Cannot refund a ${order.status} order`);
    }
    if (order.stripe_payment_intent) {
      await payments.refundCharge(order.stripe_payment_intent, order.total_amount);
    }
    await setOrderStatus(db, ctx.tenantId, order.id, "refunded", ctx.userId, {
      reason: req.body?.reason ?? null,
    });
    await writeAuditLog(db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "order.refund",
      resourceType: "order",
      resourceId: order.id,
    });
    const updated = await findOrderById(db, ctx.tenantId, order.id);
    res.json({ data: await loadOrderDetail(db, ctx.tenantId, updated!) });
  });

  return router;
}