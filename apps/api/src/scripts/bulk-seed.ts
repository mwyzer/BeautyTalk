import "dotenv/config";
import { hash as argon2Hash } from "@node-rs/argon2";
import { createPool, runMigrations } from "@beautyai/db";
import { createConfig } from "../config/env.js";

const config = createConfig();
const db = createPool({ connectionString: config.DATABASE_URL });

const ORDERS = Number(process.env.BULK_ORDERS ?? 1000);
const USERS = Number(process.env.BULK_USERS ?? 1000);
const CONTENT = Number(process.env.BULK_CONTENT ?? 1000);
const TENANT_SLUG = process.env.BULK_TENANT_SLUG ?? "glow-co";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = ["Ava", "Liam", "Maya", "Noah", "Sofia", "Ethan", "Olivia", "Lucas", "Emma", "Oliver", "Isla", "Mateo", "Zoe", "Kai", "Nora", "Leo", "Ivy", "Jude", "Luna", "Finn"];
const LAST_NAMES = ["Chen", "Rossi", "Park", "Novak", "Silva", "Kim", "Meyer", "Patel", "Haddad", "Okafor", "Larsen", "Costa", "Tanaka", "Berg", "Moreau", "Ali", "Vega", "Khan", "Petrov", "Green"];
const STREETS = ["12 Maple Ave", "8 Oak Lane", "45 Birch Rd", "201 Cedar St", "9 Willow Way", "77 Pine Dr", "3 Elm Court", "110 Alder Blvd", "6 Spruce St", "34 Chestnut Rd"];
const CITIES = ["Portland", "Brighton", "Oslo", "Toronto", "Austin", "Lisbon", "Wellington", "Helsinki", "Denver", "Mumbai"];
const PROVINCES = ["OR", "ENG", "OSL", "ON", "TX", "LIS", "WGN", "UUS", "CO", "MH"];
const ZIPS = ["97201", "BN1 1AA", "0150", "M5V 2T6", "78701", "1200-001", "6011", "00100", "80202", "400001"];
const COUNTRIES = ["US", "GB", "NO", "CA", "US", "PT", "NZ", "FI", "US", "IN"];
const PHONE_PREFIX = ["+1202", "+4420", "+4722", "+1416", "+1512", "+3512", "+644", "+3589", "+1303", "+9122"];
const CARRIERS = ["UPS", "FedEx", "DHL", "USPS", "Royal Mail"];
const MODELS = ["gpt-4o-mini", "gpt-4o", "stub"];

const FRAUD_SCENARIOS = {
  velocity: "fraud_velocity",
  refundAbuse: "fraud_refund_abuse",
  addressMismatch: "fraud_address_mismatch",
  burst: "fraud_new_account_burst",
} as const;

interface VariantRow { id: string; product_id: string; title: string; sku: string; price_amount: number; }
interface ProductRow { id: string; title: string; }

interface TenantCtx {
  tenantId: string;
  ownerId: string | null;
  variants: VariantRow[];
  products: ProductRow[];
  baseOrderNumber: number;
}

interface BulkUser {
  userId: string;
  customerId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  billing: Record<string, unknown>;
  shipping: Record<string, unknown>;
  tags: string[];
  createdAt: Date;
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))]!;
}

async function loadTenant(): Promise<TenantCtx> {
  const { rows: tenantRows } = await db.query<{ id: string }>("SELECT id FROM tenants WHERE slug = $1", [TENANT_SLUG]);
  const tenantId = tenantRows[0]?.id;
  if (!tenantId) throw new Error(`tenant '${TENANT_SLUG}' not found — run 'npm run db:seed' first`);
  const { rows: ownerRows } = await db.query<{ id: string }>(
    `SELECT u.id FROM tenant_memberships tm JOIN users u ON u.id = tm.user_id
     WHERE tm.tenant_id = $1 AND tm.role = 'owner' LIMIT 1`,
    [tenantId],
  );
  const { rows: variantRows } = await db.query<VariantRow>(
    "SELECT id, product_id, title, sku, price_amount FROM variants WHERE tenant_id = $1",
    [tenantId],
  );
  if (variantRows.length === 0) throw new Error("tenant has no variants — run 'npm run db:seed' first");
  const { rows: productRows } = await db.query<ProductRow>(
    "SELECT id, title FROM products WHERE tenant_id = $1", [tenantId],
  );
  const { rows: numRows } = await db.query<{ n: string }>(
    "SELECT COALESCE(MAX(number), 1000) AS n FROM orders WHERE tenant_id = $1", [tenantId],
  );
  return {
    tenantId,
    ownerId: ownerRows[0]?.id ?? null,
    variants: variantRows,
    products: productRows,
    baseOrderNumber: Number(numRows[0]?.n ?? 1000),
  };
}

async function wipeBulkData(tenantId: string): Promise<void> {
  const { rows } = await db.query<{ id: string; user_id: string | null }>(
    "SELECT id, user_id FROM customers WHERE tenant_id = $1 AND email LIKE 'bulk-%.customer.test'", [tenantId],
  );
  await db.query("DELETE FROM orders WHERE tenant_id = $1", [tenantId]);
  await db.query("DELETE FROM carts WHERE tenant_id = $1", [tenantId]);
  await db.query("DELETE FROM customers WHERE tenant_id = $1 AND email LIKE 'bulk-%.customer.test'", [tenantId]);
  await db.query("DELETE FROM content_versions WHERE draft_id IN (SELECT id FROM content_drafts WHERE tenant_id = $1)", [tenantId]);
  await db.query("DELETE FROM content_drafts WHERE tenant_id = $1", [tenantId]);
  await db.query("DELETE FROM credit_ledger WHERE tenant_id = $1", [tenantId]);
  await db.query("UPDATE feature_quotas SET used = 0, quota_limit = -1 WHERE tenant_id = $1 AND feature = 'content_credits'", [tenantId]);
  const userIds = rows.filter((r) => r.user_id).map((r) => r.user_id as string);
  for (let i = 0; i < userIds.length; i += 100) {
    await db.query("DELETE FROM users WHERE id = ANY($1)", [userIds.slice(i, i + 100)]);
  }
}

function genUsers(rand: () => number, base: number): Omit<BulkUser, "userId" | "customerId">[] {
  return Array.from({ length: base }, (_, i) => {
    const firstName = pick(rand, FIRST_NAMES);
    const lastName = pick(rand, LAST_NAMES);
    const addrIdx = Math.floor(rand() * STREETS.length);
    const shippingIdx = rand() < 0.15 ? Math.floor(rand() * STREETS.length) : addrIdx;
    const n = i / base;
    let tags: string[] = [];
    if (n < 0.03) tags = [FRAUD_SCENARIOS.velocity];
    else if (n < 0.06) tags = [FRAUD_SCENARIOS.refundAbuse];
    else if (n < 0.09) tags = [FRAUD_SCENARIOS.addressMismatch];
    else if (n < 0.11) tags = [FRAUD_SCENARIOS.burst];
    return {
      email: `bulk-${i + 1}@customer.test`,
      firstName,
      lastName,
      phone: `${pick(rand, PHONE_PREFIX)}${String(Math.floor(rand() * 9000000) + 1000000)}`,
      billing: {
        address1: STREETS[addrIdx], city: CITIES[addrIdx], province: PROVINCES[addrIdx], zip: ZIPS[addrIdx], country: COUNTRIES[addrIdx],
      },
      shipping: {
        address1: STREETS[shippingIdx], city: CITIES[shippingIdx], province: PROVINCES[shippingIdx], zip: ZIPS[shippingIdx], country: COUNTRIES[shippingIdx],
      },
      tags,
      createdAt: new Date(Date.now() - Math.floor(rand() * 330) * 86_400_000),
    };
  });
}

async function insertUsers(rand: () => number, tenantId: string): Promise<BulkUser[]> {
  const passwordHash = await argon2Hash("Password123!");
  const users: BulkUser[] = [];
  const generated = genUsers(rand, USERS);
  for (let i = 0; i < generated.length; i++) {
    const g = generated[i]!;
    const ures = await db.query<{ id: string }>(
      "INSERT INTO users (email, password_hash, full_name, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [g.email, passwordHash, `${g.firstName} ${g.lastName}`, g.createdAt],
    );
    const cres = await db.query<{ id: string }>(
      `INSERT INTO customers (tenant_id, user_id, email, first_name, last_name, phone, tags, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tenantId, ures.rows[0]!.id, g.email, g.firstName, g.lastName, g.phone, g.tags, g.createdAt],
    );
    await db.query(
      `INSERT INTO customer_addresses (tenant_id, customer_id, label, first_name, last_name, address1, city, province, zip, country, phone, is_default)
       VALUES ($1, $2, 'Home', $3, $4, $5, $6, $7, $8, $9, $10, true)`,
      [tenantId, cres.rows[0]!.id, g.firstName, g.lastName, g.billing.address1, g.billing.city, g.billing.province, g.billing.zip, g.billing.country, g.phone],
    );
    if (g.tags.includes(FRAUD_SCENARIOS.addressMismatch)) {
      await db.query(
        `INSERT INTO customer_addresses (tenant_id, customer_id, label, first_name, last_name, address1, city, province, zip, country, phone, is_default)
         VALUES ($1, $2, 'Shipping', $3, $4, $5, $6, $7, $8, $9, $10, false)`,
        [tenantId, cres.rows[0]!.id, g.firstName, g.lastName, g.shipping.address1, g.shipping.city, g.shipping.province, g.shipping.zip, g.shipping.country, g.phone],
      );
    }
    users.push({
      userId: ures.rows[0]!.id,
      customerId: cres.rows[0]!.id,
      email: g.email,
      firstName: g.firstName,
      lastName: g.lastName,
      phone: g.phone,
      billing: g.billing,
      shipping: g.shipping,
      tags: g.tags,
      createdAt: g.createdAt,
    });
    if (i % 100 === 0) console.log(`  users ${i}/${USERS}`);
  }
  return users;
}

async function insertOrders(rand: () => number, ctx: TenantCtx, users: BulkUser[]): Promise<void> {
  const statusWeights: Array<[string, number]> = [
    ["paid", 0.2],
    ["fulfilled", 0.22],
    ["shipped", 0.18],
    ["delivered", 0.25],
    ["cancelled", 0.08],
    ["refunded", 0.07],
  ];
  let orderNumber = ctx.baseOrderNumber;
  const fraudCounters: Record<string, number> = {};
  for (let i = 0; i < ORDERS; i++) {
    const customer = pick(rand, users);
    const velocity = customer.tags.includes(FRAUD_SCENARIOS.velocity);
    const refundAbuse = customer.tags.includes(FRAUD_SCENARIOS.refundAbuse);
    const mismatch = customer.tags.includes(FRAUD_SCENARIOS.addressMismatch);
    const burst = customer.tags.includes(FRAUD_SCENARIOS.burst);

    let status = (() => {
      let r = rand();
      for (const [s, w] of statusWeights) {
        if (r < w) return s;
        r -= w;
      }
      return "paid";
    })();
    let placedAt = new Date(Date.now() - Math.floor(rand() * 90) * 86_400_000);
    if (velocity) {
      placedAt = new Date(Date.now() - Math.floor(rand() * 3) * 3_600_000);
      status = rand() < 0.8 ? "paid" : "refunded";
    }
    if (refundAbuse) status = rand() < 0.9 ? "refunded" : "cancelled";
    if (burst) {
      placedAt = new Date(Date.now() - Math.floor(rand() * 24) * 3_600_000);
      status = rand() < 0.6 ? "cancelled" : "paid";
    }

    const variant = pick(rand, ctx.variants);
    const product = ctx.products.find((p) => p.id === variant.product_id) ?? ctx.products[0]!;
    const qty = burst ? 1 : 1 + Math.floor(rand() * 2);
    const subtotal = variant.price_amount * qty;
    const shipping = 400;
    const tax = Math.round(subtotal * 0.08);
    const total = subtotal + shipping + tax;

    ++orderNumber;
    const orderRes = await db.query<{ id: string }>(
      `INSERT INTO orders (tenant_id, customer_id, number, status, email, subtotal_amount, shipping_amount, tax_amount, total_amount,
         stripe_session_id, stripe_payment_intent, placed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $12) RETURNING id`,
      [
        ctx.tenantId, customer.customerId, orderNumber, status, customer.email,
        subtotal, shipping, tax, total,
        `cs_bulk_${orderNumber}`, `pi_bulk_${orderNumber}`, placedAt,
      ],
    );
    const orderId = orderRes.rows[0]!.id;

    await db.query(
      `INSERT INTO order_items (tenant_id, order_id, variant_id, product_title, variant_title, sku, unit_price_amount, quantity, line_total_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [ctx.tenantId, orderId, variant.id, product.title, variant.title, variant.sku, variant.price_amount, qty, subtotal],
    );
    await db.query(
      `UPDATE inventory i SET quantity = GREATEST(0, i.quantity - $3), updated_at = now()
       FROM variants v WHERE v.id = $2 AND v.tenant_id = $1 AND i.variant_id = v.id`,
      [ctx.tenantId, variant.id, qty],
    );

    await db.query(
      `INSERT INTO order_events (tenant_id, order_id, type, metadata, created_at)
       VALUES ($1, $2, 'created', $3, $4)`,
      [ctx.tenantId, orderId, JSON.stringify({ via: "bulk_seed" }), placedAt],
    );
    if (status === "shipped" || status === "delivered") {
      await db.query(
        `INSERT INTO order_events (tenant_id, order_id, type, metadata, created_at)
         VALUES ($1, $2, 'fulfilled', $3, $4), ($1, $2, $5, $3, $4)`,
        [ctx.tenantId, orderId, JSON.stringify({ via: "bulk_seed" }), placedAt, status],
      );
      await db.query(
        `INSERT INTO shipments (tenant_id, order_id, carrier, tracking_number, status, shipped_at, address, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          ctx.tenantId, orderId, pick(rand, CARRIERS), `1Z${String(orderNumber).padStart(16, "0")}`,
          status === "delivered" ? "delivered" : "in_transit", placedAt,
          JSON.stringify(mismatch ? customer.shipping : customer.billing), placedAt,
        ],
      );
    } else {
      await db.query(
        `INSERT INTO order_events (tenant_id, order_id, type, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [ctx.tenantId, orderId, status, JSON.stringify({ via: "bulk_seed" }), placedAt],
      );
    }

    await db.query(
      `UPDATE customers SET orders_count = orders_count + 1, total_spent_amount = total_spent_amount + $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [ctx.tenantId, customer.customerId, status === "refunded" || status === "cancelled" ? 0 : total],
    );

    for (const tag of customer.tags) fraudCounters[tag] = (fraudCounters[tag] ?? 0) + 1;
    if (i % 100 === 0) console.log(`  orders ${i}/${ORDERS}`);
  }
  console.log(`  fraud scenario orders seen:`, fraudCounters);
}

async function insertContent(rand: () => number, ctx: TenantCtx): Promise<void> {
  const contentStatuses = ["draft", "draft", "approved", "published", "published", "rejected"];
  await db.query("UPDATE feature_quotas SET used = 0, quota_limit = -1 WHERE tenant_id = $1 AND feature = 'content_credits'", [ctx.tenantId]);
  for (let i = 0; i < CONTENT; i++) {
    const product = pick(rand, ctx.products);
    const type = rand() < 0.5 ? "product_description" : "meta";
    const status = pick(rand, contentStatuses);
    const model = pick(rand, MODELS);
    const createdAt = new Date(Date.now() - Math.floor(rand() * 60) * 86_400_000);
    const draftRes = await db.query<{ id: string }>(
      `INSERT INTO content_drafts (tenant_id, type, target_type, target_id, title, body, meta_title, meta_description, status, llm_model, prompt_snapshot, created_by, created_at, updated_at)
       VALUES ($1, $2, 'product', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
      [
        ctx.tenantId, type, product.id,
        type === "meta" ? `${product.title} — SEO Meta` : `${product.title} — ${model}`,
        type === "meta" ? null : `Bulk-generated description for ${product.title} (${model}).`,
        type === "meta" ? `${product.title} | Glow Co.` : null,
        type === "meta" ? `Shop ${product.title}. Dermatologist-grade formulas backed by evidence.` : null,
        status, model, { via: "bulk_seed", productId: product.id }, ctx.ownerId, createdAt,
      ],
    );
    const draftId = draftRes.rows[0]!.id;
    await db.query(
      `INSERT INTO content_versions (draft_id, version, body, meta_title, meta_description, change_summary, created_by, created_at)
       VALUES ($1, 1, $2, $3, $4, 'initial bulk generation', $5, $6)`,
      [
        draftId,
        type === "meta" ? null : `Bulk-generated description for ${product.title}.`,
        type === "meta" ? `${product.title} | Glow Co.` : null,
        type === "meta" ? `Shop ${product.title}. Dermatologist-grade formulas.` : null,
        ctx.ownerId, createdAt,
      ],
    );
    if (status === "approved" || status === "published") {
      await db.query(
        "UPDATE content_drafts SET approved_at = $3 WHERE id = $1 AND tenant_id = $2",
        [draftId, ctx.tenantId, createdAt],
      );
    }
    if (status === "published") {
      await db.query(
        "UPDATE content_drafts SET published_at = $3 WHERE id = $1 AND tenant_id = $2",
        [draftId, ctx.tenantId, createdAt],
      );
    }
    await db.query(
      `INSERT INTO credit_ledger (tenant_id, user_id, operation, amount, metadata, created_at)
       VALUES ($1, $2, 'content.generated', -1, $3, $4)`,
      [ctx.tenantId, ctx.ownerId, { via: "bulk_seed", draft_id: draftId }, createdAt],
    );
    if (i % 100 === 0) console.log(`  content ${i}/${CONTENT}`);
  }
}

async function main(): Promise<void> {
  const rand = mulberry32(20260910);
  console.log(`bulk seed: tenant=${TENANT_SLUG} users=${USERS} orders=${ORDERS} content=${CONTENT}`);
  const applied = await runMigrations(db);
  if (applied.length > 0) console.log(`applied migrations: ${applied.join(", ")}`);
  const ctx = await loadTenant();
  await wipeBulkData(ctx.tenantId);

  const t0 = Date.now();
  const users = await insertUsers(rand, ctx.tenantId);
  console.log(`  users done (${Date.now() - t0}ms)`);

  const t1 = Date.now();
  await insertOrders(rand, ctx, users);
  console.log(`  orders done (${Date.now() - t1}ms)`);

  const t2 = Date.now();
  await insertContent(rand, ctx);
  console.log(`  content done (${Date.now() - t2}ms)`);

  const [cUsers, cOrders, cContent] = await Promise.all([
    db.query<{ n: string }>("SELECT count(*)::text n FROM customers WHERE tenant_id = $1", [ctx.tenantId]),
    db.query<{ n: string }>("SELECT count(*)::text n FROM orders WHERE tenant_id = $1", [ctx.tenantId]),
    db.query<{ n: string }>("SELECT count(*)::text n FROM content_drafts WHERE tenant_id = $1", [ctx.tenantId]),
  ]);
  console.log(
    `\ntotals — customers: ${cUsers.rows[0]!.n}, orders: ${cOrders.rows[0]!.n}, content_drafts: ${cContent.rows[0]!.n}\n` +
    `(all bulk users login with bulk-N@customer.test / Password123!)`,
  );
  await db.end();
}

void main().catch(async (err) => {
  console.error(err);
  await db.end();
  process.exit(1);
});