import type { Db } from "@beautyai/db";
import type {
  Order,
  OrderCustomer,
  OrderEvent,
  OrderItem,
  OrderShipment,
  OrderStatus,
} from "@beautyai/shared";
import { ApiError } from "../lib/http.js";

export interface CreateOrderInput {
  tenantId: string;
  customerId: string | null;
  cartId: string;
  email: string | null;
  stripeSessionId: string;
  stripePaymentIntent: string | null;
  items: Array<{
    variantId: string;
    productTitle: string;
    variantTitle: string;
    sku: string | null;
    unitPriceAmount: number;
    quantity: number;
  }>;
  subtotalAmount: number;
  shippingAmount: number;
  taxAmount: number;
}

export interface OrderRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  number: number;
  status: string;
  email: string | null;
  subtotal_amount: number;
  discount_amount: number;
  shipping_amount: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  notes: string | null;
  placed_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface OrderEventRow {
  id: string;
  tenant_id: string;
  order_id: string;
  type: string;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface ShipmentRow {
  id: string;
  tenant_id: string;
  order_id: string;
  carrier: string | null;
  tracking_number: string | null;
  status: string;
  shipped_at: Date | null;
  address: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  variant_id: string | null;
  product_title: string;
  variant_title: string;
  sku: string | null;
  unit_price_amount: number;
  quantity: number;
  line_total_amount: number;
}

interface CustomerRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export async function nextOrderNumber(db: Db, tenantId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    "SELECT COALESCE(MAX(number), 1000) + 1 AS n FROM orders WHERE tenant_id = $1",
    [tenantId],
  );
  return Number(rows[0]?.n ?? 1001);
}

export async function createOrder(db: Db, tenantId: string, input: CreateOrderInput): Promise<OrderRow> {
  const number = await nextOrderNumber(db, tenantId);
  const total = input.subtotalAmount + input.shippingAmount + input.taxAmount;
  const { rows } = await db.query<OrderRow>(
    `INSERT INTO orders (tenant_id, customer_id, number, status, email, subtotal_amount, shipping_amount, tax_amount,
       total_amount, stripe_session_id, stripe_payment_intent, placed_at)
     VALUES ($1, $2, $3, 'paid', $4, $5, $6, $7, $8, $9, $10, now())
     RETURNING *`,
    [
      tenantId,
      input.customerId,
      number,
      input.email,
      input.subtotalAmount,
      input.shippingAmount,
      input.taxAmount,
      total,
      input.stripeSessionId,
      input.stripePaymentIntent,
    ],
  );
  const order = rows[0]!;

  for (const item of input.items) {
    await db.query(
      `INSERT INTO order_items (tenant_id, order_id, variant_id, product_title, variant_title, sku, unit_price_amount, quantity, line_total_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        order.id,
        item.variantId,
        item.productTitle,
        item.variantTitle,
        item.sku,
        item.unitPriceAmount,
        item.quantity,
        item.unitPriceAmount * item.quantity,
      ],
    );
    await db.query(
      `UPDATE inventory i SET quantity = i.quantity - $3, updated_at = now()
       FROM variants v
       WHERE v.id = $2 AND v.tenant_id = $1 AND i.variant_id = v.id AND i.quantity >= $3`,
      [tenantId, item.variantId, item.quantity],
    );
  }

  await db.query(
    `INSERT INTO order_events (tenant_id, order_id, type, metadata)
     VALUES ($1, $2, 'created', $3), ($1, $2, 'paid', $3)`,
    [tenantId, order.id, JSON.stringify({ via: "checkout.session.completed" })],
  );

  return order;
}

export async function listOrders(
  db: Db,
  tenantId: string,
  opts: { status?: OrderStatus; page?: number; limit?: number } = {},
): Promise<{ data: OrderRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const clauses: string[] = ["tenant_id = $1"];
  const values: unknown[] = [tenantId];
  if (opts.status) {
    values.push(opts.status);
    clauses.push(`status = $${values.length}`);
  }
  const where = ` WHERE ${clauses.join(" AND ")}`;
  const { rows } = await db.query<OrderRow>(
    `SELECT * FROM orders${where} ORDER BY placed_at DESC, created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    values,
  );
  const count = await db.query<{ n: string }>(`SELECT COUNT(*)::text n FROM orders${where}`, values);
  return { data: rows, total: Number(count.rows[0]?.n ?? 0) };
}

export async function findOrderById(db: Db, tenantId: string, id: string): Promise<OrderRow | null> {
  const { rows } = await db.query<OrderRow>(
    "SELECT * FROM orders WHERE tenant_id = $1 AND id = $2",
    [tenantId, id],
  );
  return rows[0] ?? null;
}

export async function findOrderBySession(db: Db, tenantId: string, sessionId: string): Promise<OrderRow | null> {
  const { rows } = await db.query<OrderRow>(
    "SELECT * FROM orders WHERE tenant_id = $1 AND stripe_session_id = $2",
    [tenantId, sessionId],
  );
  return rows[0] ?? null;
}

export async function listOrderItems(db: Db, tenantId: string, orderId: string): Promise<OrderItemRow[]> {
  const { rows } = await db.query<OrderItemRow>(
    `SELECT id, order_id, variant_id, product_title, variant_title, sku, unit_price_amount, quantity, line_total_amount
     FROM order_items WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at ASC`,
    [tenantId, orderId],
  );
  return rows;
}

export async function listOrderEvents(db: Db, tenantId: string, orderId: string): Promise<OrderEventRow[]> {
  const { rows } = await db.query<OrderEventRow>(
    `SELECT id, tenant_id, order_id, type, actor_id, metadata, created_at
     FROM order_events WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at ASC`,
    [tenantId, orderId],
  );
  return rows;
}

export async function listOrderShipments(db: Db, tenantId: string, orderId: string): Promise<ShipmentRow[]> {
  const { rows } = await db.query<ShipmentRow>(
    `SELECT id, tenant_id, order_id, carrier, tracking_number, status, shipped_at, address, created_at, updated_at
     FROM shipments WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at ASC`,
    [tenantId, orderId],
  );
  return rows;
}

export async function getOrderCustomer(db: Db, tenantId: string, orderId: string): Promise<CustomerRow | null> {
  const { rows } = await db.query<CustomerRow>(
    `SELECT c.id, c.email, c.first_name, c.last_name
     FROM orders o LEFT JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
     WHERE o.tenant_id = $1 AND o.id = $2`,
    [tenantId, orderId],
  );
  return rows[0] ?? null;
}

export async function loadOrderDetail(db: Db, tenantId: string, order: OrderRow): Promise<Order> {
  const [items, events, shipments, customer] = await Promise.all([
    listOrderItems(db, tenantId, order.id),
    listOrderEvents(db, tenantId, order.id),
    listOrderShipments(db, tenantId, order.id),
    getOrderCustomer(db, tenantId, order.id),
  ]);
  const toItem = (r: OrderItemRow): OrderItem => ({
    id: r.id,
    variantId: r.variant_id,
    productTitle: r.product_title,
    variantTitle: r.variant_title,
    sku: r.sku,
    unitPriceAmount: r.unit_price_amount,
    quantity: r.quantity,
    lineTotalAmount: r.line_total_amount,
  });
  const toEvent = (r: OrderEventRow): OrderEvent => ({
    id: r.id,
    type: r.type,
    actorId: r.actor_id,
    metadata: r.metadata,
    createdAt: r.created_at.toISOString(),
  });
  const toShipment = (r: ShipmentRow): OrderShipment => ({
    id: r.id,
    carrier: r.carrier,
    trackingNumber: r.tracking_number,
    status: r.status,
    shippedAt: r.shipped_at ? r.shipped_at.toISOString() : null,
    address: r.address,
  });
  const oc: OrderCustomer = customer
    ? { id: customer.id, email: customer.email, firstName: customer.first_name, lastName: customer.last_name }
    : { id: null, email: order.email, firstName: null, lastName: null };
  return {
    id: order.id,
    tenantId: order.tenant_id,
    number: order.number,
    status: order.status as OrderStatus,
    email: order.email,
    subtotalAmount: order.subtotal_amount,
    discountAmount: order.discount_amount,
    shippingAmount: order.shipping_amount,
    taxAmount: order.tax_amount,
    totalAmount: order.total_amount,
    currency: order.currency,
    stripeSessionId: order.stripe_session_id,
    notes: order.notes,
    placedAt: order.placed_at.toISOString(),
    createdAt: order.created_at.toISOString(),
    updatedAt: order.updated_at.toISOString(),
    customer: oc,
    items: items.map(toItem),
    events: events.map(toEvent),
    shipments: shipments.map(toShipment),
  };
}

export async function setOrderStatus(
  db: Db,
  tenantId: string,
  orderId: string,
  status: OrderStatus,
  actorId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `UPDATE orders SET status = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`,
    [status, tenantId, orderId],
  );
  await db.query(
    `INSERT INTO order_events (tenant_id, order_id, type, actor_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, orderId, status, actorId, metadata ? JSON.stringify(metadata) : null],
  );
}

export async function setOrderNotes(db: Db, tenantId: string, orderId: string, notes: string | null): Promise<void> {
  await db.query(
    `UPDATE orders SET notes = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`,
    [notes, tenantId, orderId],
  );
}

export async function createShipment(
  db: Db,
  tenantId: string,
  orderId: string,
  input: { carrier: string; trackingNumber: string | null },
): Promise<ShipmentRow> {
  const { rows } = await db.query<ShipmentRow>(
    `INSERT INTO shipments (tenant_id, order_id, carrier, tracking_number, status, shipped_at)
     VALUES ($1, $2, $3, $4, 'processed', now())
     RETURNING *`,
    [tenantId, orderId, input.carrier, input.trackingNumber],
  );
  return rows[0]!;
}

export function assertOrderEditable(order: OrderRow | null, tenantId: string, _forAction: string): OrderRow {
  if (!order || order.tenant_id !== tenantId) throw ApiError.notFound("Order not found");
  return order;
}