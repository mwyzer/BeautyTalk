import type { Db } from "@beautyai/db";
import type { Cart, CartItemPayload } from "@beautyai/shared";
import { ApiError } from "../lib/http.js";

export interface CartRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  discount_code: string | null;
  status: string;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CartItemRow {
  id: string;
  tenant_id: string;
  cart_id: string;
  variant_id: string;
  quantity: number;
  unit_price_amount: number;
  created_at: Date;
}

export interface CartItemJoinRow extends CartItemRow {
  product_id: string;
  product_title: string;
  product_handle: string;
  variant_title: string;
  sku: string;
  image_url: string | null;
  inventory_qty: number;
}

export async function createCart(db: Db, tenantId: string, customerId: string | null = null): Promise<CartRow> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const { rows } = await db.query<CartRow>(
    `INSERT INTO carts (tenant_id, customer_id, expires_at) VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, customerId, expiresAt],
  );
  return rows[0]!;
}

export async function findCartById(db: Db, tenantId: string, cartId: string): Promise<CartRow | null> {
  const { rows } = await db.query<CartRow>(
    "SELECT * FROM carts WHERE tenant_id = $1 AND id = $2 AND status = 'active'",
    [tenantId, cartId],
  );
  return rows[0] ?? null;
}

export async function loadCartItems(db: Db, tenantId: string, cartId: string): Promise<CartItemJoinRow[]> {
  const { rows } = await db.query<CartItemJoinRow>(
    `SELECT ci.id, ci.tenant_id, ci.cart_id, ci.variant_id, ci.quantity, ci.unit_price_amount, ci.created_at,
       v.product_id, p.title AS product_title, p.handle AS product_handle,
       v.title AS variant_title, v.sku,
       (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position ASC, pi.created_at ASC LIMIT 1) AS image_url,
       COALESCE(i.quantity, 0) AS inventory_qty
     FROM cart_items ci
     JOIN variants v ON v.id = ci.variant_id AND v.tenant_id = ci.tenant_id
     JOIN products p ON p.id = v.product_id AND p.tenant_id = ci.tenant_id
     LEFT JOIN inventory i ON i.variant_id = v.id AND i.tenant_id = v.tenant_id
     WHERE ci.tenant_id = $1 AND ci.cart_id = $2
     ORDER BY ci.created_at ASC`,
    [tenantId, cartId],
  );
  return rows;
}

export async function loadCart(
  db: Db,
  tenantId: string,
  cartId: string,
): Promise<Cart | null> {
  const cart = await findCartById(db, tenantId, cartId);
  if (!cart) return null;
  const items = await loadCartItems(db, tenantId, cartId);
  const payload: CartItemPayload[] = items.map((row) => ({
    id: row.id,
    variantId: row.variant_id,
    quantity: row.quantity,
    unitPriceAmount: row.unit_price_amount,
    productId: row.product_id,
    productTitle: row.product_title,
    productHandle: row.product_handle,
    variantTitle: row.variant_title,
    sku: row.sku,
    imageUrl: row.image_url,
    inventoryQty: row.inventory_qty,
    lineTotalAmount: row.unit_price_amount * row.quantity,
  }));
  return {
    id: cart.id,
    tenantId: cart.tenant_id,
    customerId: cart.customer_id,
    discountCode: cart.discount_code,
    subtotalAmount: payload.reduce((sum, i) => sum + i.lineTotalAmount, 0),
    itemCount: payload.reduce((sum, i) => sum + i.quantity, 0),
    items: payload,
  };
}

export async function addItem(
  db: Db,
  tenantId: string,
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<void> {
  const variant = await db.query<{ id: string; price_amount: number; inventory_qty: number }>(
    `SELECT v.id, v.price_amount, COALESCE(i.quantity, 0) AS inventory_qty
     FROM variants v LEFT JOIN inventory i ON i.variant_id = v.id AND i.tenant_id = v.tenant_id
     WHERE v.tenant_id = $1 AND v.id = $2`,
    [tenantId, variantId],
  );
  const v = variant.rows[0];
  if (!v) throw ApiError.notFound("Variant not found");
  const inventoryQty = Number(v.inventory_qty);
  if (quantity > inventoryQty) throw ApiError.conflict(`Only ${inventoryQty} in stock`);

  const current = await db.query<{ quantity: number }>(
    `SELECT quantity FROM cart_items WHERE tenant_id = $1 AND cart_id = $2 AND variant_id = $3`,
    [tenantId, cartId, variantId],
  );
  const newQty = (current.rows[0]?.quantity ?? 0) + quantity;
  if (newQty > inventoryQty) throw ApiError.conflict(`Only ${inventoryQty} in stock`);

  await db.query(
    `INSERT INTO cart_items (tenant_id, cart_id, variant_id, quantity, unit_price_amount)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [tenantId, cartId, variantId, newQty, v.price_amount],
  );
  await db.query(`UPDATE carts SET updated_at = now() WHERE id = $1`, [cartId]);
}

export async function updateItem(db: Db, tenantId: string, cartId: string, itemId: string, quantity: number): Promise<void> {
  const item = await db.query<{ variant_id: string }>(
    "SELECT variant_id FROM cart_items WHERE tenant_id = $1 AND cart_id = $2 AND id = $3",
    [tenantId, cartId, itemId],
  );
  if (!item.rows[0]) throw ApiError.notFound("Cart item not found");
  if (quantity <= 0) {
    await db.query("DELETE FROM cart_items WHERE tenant_id = $1 AND cart_id = $2 AND id = $3", [tenantId, cartId, itemId]);
    return;
  }
  const invariant = await db.query<{ inventory_qty: number }>(
    `SELECT COALESCE(i.quantity, 0) AS inventory_qty
     FROM inventory i WHERE i.variant_id = $1 AND i.tenant_id = $2`,
    [item.rows[0].variant_id, tenantId],
  );
  const inventoryQty = Number(invariant.rows[0]?.inventory_qty ?? 0);
  if (quantity > inventoryQty) throw ApiError.conflict(`Only ${inventoryQty} in stock`);
  await db.query(
    `UPDATE cart_items SET quantity = $1 WHERE tenant_id = $2 AND cart_id = $3 AND id = $4`,
    [quantity, tenantId, cartId, itemId],
  );
  await db.query(`UPDATE carts SET updated_at = now() WHERE id = $1`, [cartId]);
}

export async function removeItem(db: Db, tenantId: string, cartId: string, itemId: string): Promise<void> {
  await db.query("DELETE FROM cart_items WHERE tenant_id = $1 AND cart_id = $2 AND id = $3", [tenantId, cartId, itemId]);
  await db.query(`UPDATE carts SET updated_at = now() WHERE id = $1`, [cartId]);
}

export async function markCartConverted(db: Db, tenantId: string, cartId: string): Promise<void> {
  await db.query(
    `UPDATE carts SET status = 'converted', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, cartId],
  );
}