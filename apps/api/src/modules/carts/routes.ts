import { Router } from "express";
import type { Db } from "@beautyai/db";
import { addCartItemSchema, updateCartItemSchema, type AddCartItemInput } from "@beautyai/shared";
import { validateBody } from "../../middleware/validate.js";
import { resolveTenant } from "../../middleware/tenant.js";
import { ApiError } from "../../lib/http.js";
import {
  addItem,
  createCart,
  loadCart,
  removeItem,
  updateItem,
} from "../../repositories/carts.repo.js";

export function createCartsRouter(db: Db): Router {
  const router = Router();
  router.use(resolveTenant(db));

  router.post("/", async (req, res) => {
    const tenantId = req.tenant!.id;
    const cart = await createCart(db, tenantId);
    res.status(201).json({ data: await loadCart(db, tenantId, cart.id) });
  });

  router.get("/:id", async (req, res) => {
    const cart = await loadCart(db, req.tenant!.id, String(req.params.id));
    if (!cart) throw ApiError.notFound("Cart not found");
    res.json({ data: cart });
  });

  router.post("/:id/items", validateBody(addCartItemSchema), async (req, res) => {
    const tenantId = req.tenant!.id;
    const cart = await loadCart(db, tenantId, String(req.params.id));
    if (!cart) throw ApiError.notFound("Cart not found");
    const body = req.body as AddCartItemInput;
    await addItem(db, tenantId, cart.id, body.variantId, body.quantity);
    res.json({ data: await loadCart(db, tenantId, cart.id) });
  });

  router.patch("/:id/items/:itemId", validateBody(updateCartItemSchema), async (req, res) => {
    const tenantId = req.tenant!.id;
    const cart = await loadCart(db, tenantId, String(req.params.id));
    if (!cart) throw ApiError.notFound("Cart not found");
    await updateItem(db, tenantId, cart.id, String(req.params.itemId), req.body.quantity);
    res.json({ data: await loadCart(db, tenantId, cart.id) });
  });

  router.delete("/:id/items/:itemId", async (req, res) => {
    const tenantId = req.tenant!.id;
    const cart = await loadCart(db, tenantId, String(req.params.id));
    if (!cart) throw ApiError.notFound("Cart not found");
    await removeItem(db, tenantId, cart.id, String(req.params.itemId));
    res.json({ data: await loadCart(db, tenantId, cart.id) });
  });

  return router;
}