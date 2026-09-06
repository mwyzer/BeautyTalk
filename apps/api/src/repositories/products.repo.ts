import type { Db } from "@beautyai/db";
import type { Product, ProductSeo, ProductVariant, ProductImage } from "@beautyai/shared";
import { createHandle } from "@beautyai/shared";
import type { ProductCreateInput, ProductUpdateInput } from "@beautyai/shared";

export interface ProductRow {
  id: string;
  tenant_id: string;
  title: string;
  handle: string;
  description: string | null;
  body_html: string | null;
  status: string;
  vendor: string | null;
  product_type: string | null;
  tags: string[] | null;
  attributes: Record<string, unknown> | null;
  template: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface VariantRow {
  id: string;
  tenant_id: string;
  product_id: string;
  title: string;
  sku: string;
  barcode: string | null;
  price_amount: number;
  compare_at_price: number | null;
  weight_g: number | null;
  option_values: Record<string, unknown> | null;
  position: number;
  is_default: boolean;
  inventory_qty: number;
}

export interface SeoRow {
  tenant_id: string;
  product_id: string;
  meta_title: string | null;
  meta_description: string | null;
  keywords: string[] | null;
  og_title: string | null;
  og_description: string | null;
  canonical_url: string | null;
}

export interface ProductImageRow {
  id: string;
  tenant_id: string;
  product_id: string;
  url: string;
  alt: string | null;
  position: number;
  width: number | null;
  height: number | null;
  created_at: Date;
}

export interface ListParams {
  q?: string;
  collection?: string;
  tag?: string;
  productType?: string;
  includeArchived?: boolean;
  page?: number;
  limit?: number;
  sort?: string;
}

const productSelect = `SELECT p.id, p.tenant_id, p.title, p.handle, p.description, p.body_html,
  p.status, p.vendor, p.product_type, p.tags, p.attributes, p.template, p.published_at,
  p.created_at, p.updated_at FROM products p`;

function applyListFilters(sql: string, params: unknown[], { q, collection, tag, productType, includeArchived }: ListParams): string {
  const clauses: string[] = ["p.tenant_id = $1"];
  let idx = params.length;

  if (!includeArchived) clauses.push("p.status <> 'archived'");
  if (tag) {
    idx += 1;
    clauses.push(`$${idx} = ANY(p.tags)`);
    params.push(tag);
  }
  if (productType) {
    idx += 1;
    clauses.push("p.product_type = $" + idx);
    params.push(productType);
  }
  if (q) {
    idx += 1;
    clauses.push(`(p.title ILIKE '%' || $${idx} || '%' OR p.description ILIKE '%' || $${idx} || '%')`);
    params.push(q);
  }
  if (collection) {
    clauses.push(
      `EXISTS (SELECT 1 FROM product_collection pc JOIN collections c ON c.id = pc.collection_id
         WHERE pc.product_id = p.id AND c.tenant_id = p.tenant_id AND c.handle = $${++idx})`,
    );
    params.push(collection);
  }
  return `${sql} WHERE ${clauses.join(" AND ")}`;
}

export async function listProducts(
  db: Db,
  tenantId: string,
  params: ListParams = {},
): Promise<{ data: ProductRow[]; total: number }> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 25));
  const values: unknown[] = [tenantId];

  let sql = productSelect;
  sql = applyListFilters(sql, values, params);

  const sortable = ["created_at", "title", "price"];
  const direction = params.sort?.startsWith("-") ? "DESC" : "ASC";
  const sortField = (params.sort?.replace(/^-/, "") ?? "created_at");
  const orderBy = sortable.includes(sortField) ? sortField : "created_at";

  const { rows } = await db.query<ProductRow>(
    `${sql} ORDER BY p.${orderBy} ${direction} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    values,
  );
  const count = await db.query<{ n: string }>(sql.replace(/^SELECT[\s\S]*?FROM products p/, "SELECT COUNT(*)::text n FROM products p"), values);
  return { data: rows, total: Number(count.rows[0]?.n ?? 0) };
}

export async function findProductById(db: Db, tenantId: string, id: string): Promise<ProductRow | null> {
  const { rows } = await db.query<ProductRow>(`${productSelect} WHERE p.tenant_id = $1 AND p.id = $2`, [tenantId, id]);
  return rows[0] ?? null;
}

export async function findProductByHandle(db: Db, tenantId: string, handle: string): Promise<ProductRow | null> {
  const { rows } = await db.query<ProductRow>(`${productSelect} WHERE p.tenant_id = $1 AND p.handle = $2`, [tenantId, handle]);
  return rows[0] ?? null;
}

export async function listVariants(db: Db, tenantId: string, productId: string): Promise<VariantRow[]> {
  const { rows } = await db.query<VariantRow>(
    `SELECT v.id, v.tenant_id, v.product_id, v.title, v.sku, v.barcode, v.price_amount,
       v.compare_at_price, v.weight_g, v.option_values, v.position, v.is_default,
       COALESCE(i.quantity, 0) AS inventory_qty
     FROM variants v
     LEFT JOIN inventory i ON i.variant_id = v.id AND i.tenant_id = v.tenant_id
     WHERE v.tenant_id = $1 AND v.product_id = $2
     ORDER BY v.position ASC, v.created_at ASC`,
    [tenantId, productId],
  );
  return rows;
}

export async function listImages(db: Db, tenantId: string, productId: string): Promise<ProductImageRow[]> {
  const { rows } = await db.query<ProductImageRow>(
    `SELECT id, tenant_id, product_id, url, alt, position, width, height, created_at
     FROM product_images WHERE tenant_id = $1 AND product_id = $2 ORDER BY position ASC, created_at ASC`,
    [tenantId, productId],
  );
  return rows;
}

export async function findSeo(db: Db, tenantId: string, productId: string): Promise<SeoRow | null> {
  const { rows } = await db.query<SeoRow>(
    `SELECT tenant_id, product_id, meta_title, meta_description, keywords, og_title, og_description, canonical_url
     FROM product_seo WHERE tenant_id = $1 AND product_id = $2`,
    [tenantId, productId],
  );
  return rows[0] ?? null;
}

export async function listCollectionIds(db: Db, tenantId: string, productId: string): Promise<string[]> {
  const { rows } = await db.query<{ collection_id: string }>(
    `SELECT collection_id FROM product_collection
     WHERE collection_id IN (SELECT id FROM collections WHERE tenant_id = $1) AND product_id = $2`,
    [tenantId, productId],
  );
  return rows.map((r) => r.collection_id);
}

export function toVariant(row: VariantRow): ProductVariant {
  return {
    id: row.id,
    productId: row.product_id,
    title: row.title,
    sku: row.sku,
    barcode: row.barcode,
    priceAmount: row.price_amount,
    compareAtPrice: row.compare_at_price,
    weightG: row.weight_g,
    optionValues: (row.option_values as Record<string, string>) ?? {},
    position: row.position,
    isDefault: row.is_default,
    inventoryQty: row.inventory_qty,
  };
}

export function toSeo(row: SeoRow | null): ProductSeo | null {
  if (!row) return null;
  return {
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    keywords: row.keywords ?? [],
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    canonicalUrl: row.canonical_url,
  };
}

export function toImage(row: ProductImageRow): ProductImage {
  return { id: row.id, url: row.url, alt: row.alt, position: row.position };
}

export async function loadProductDetail(
  db: Db,
  tenantId: string,
  product: ProductRow,
): Promise<Product> {
  const [variants, images, seo, collectionIds] = await Promise.all([
    listVariants(db, tenantId, product.id),
    listImages(db, tenantId, product.id),
    findSeo(db, tenantId, product.id),
    listCollectionIds(db, tenantId, product.id),
  ]);
  return {
    id: product.id,
    tenantId: product.tenant_id,
    title: product.title,
    handle: product.handle,
    description: product.description,
    bodyHtml: product.body_html,
    status: product.status as Product["status"],
    vendor: product.vendor,
    productType: product.product_type,
    tags: product.tags ?? [],
    attributes: product.attributes ?? {},
    publishedAt: product.published_at ? product.published_at.toISOString() : null,
    createdAt: product.created_at.toISOString(),
    updatedAt: product.updated_at.toISOString(),
    variants: variants.map(toVariant),
    images: images.map(toImage),
    seo: toSeo(seo),
    collectionIds,
  };
}

export async function createProduct(db: Db, tenantId: string, input: ProductCreateInput & { handle?: string }): Promise<Product> {
  const handle = input.handle ?? createHandle(input.title);
  const status = input.status === "active" ? "active" : "draft";
  const { rows } = await db.query<ProductRow>(
    `INSERT INTO products (tenant_id, title, handle, description, body_html, status, vendor, product_type, tags, attributes, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, tenant_id, title, handle, description, body_html, status, vendor, product_type, tags, attributes, template, published_at, created_at, updated_at`,
    [
      tenantId,
      input.title,
      handle,
      input.description ?? null,
      input.bodyHtml ?? null,
      status,
      input.vendor ?? null,
      input.productType ?? null,
      input.tags ?? [],
      JSON.stringify(input.attributes ?? {}),
      status === "active" ? new Date() : null,
    ],
  );
  const product = rows[0]!;
  await replaceVariants(db, tenantId, product.id, input.variants);
  await replaceImages(db, tenantId, product.id, input.images ?? []);
  if (input.seo) await upsertSeo(db, tenantId, product.id, input.seo);
  if (input.collectionIds?.length) await setCollections(db, tenantId, product.id, input.collectionIds);
  return loadProductDetail(db, tenantId, product);
}

export async function updateProduct(
  db: Db,
  tenantId: string,
  product: ProductRow,
  input: ProductUpdateInput,
): Promise<Product> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (col: string, val: unknown): void => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };
  if (input.title !== undefined) add("title", input.title);
  if (input.handle !== undefined) add("handle", input.handle);
  if (input.description !== undefined) add("description", input.description);
  if (input.bodyHtml !== undefined) add("body_html", input.bodyHtml || null);
  if (input.vendor !== undefined) add("vendor", input.vendor);
  if (input.productType !== undefined) add("product_type", input.productType);
  if (input.tags !== undefined) add("tags", input.tags);
  if (input.attributes !== undefined) add("attributes", JSON.stringify(input.attributes));

  if (input.status !== undefined) {
    add("status", input.status);
    const wasArchived = product.status === "archived";
    const becomingActive = input.status === "active";
    if (!wasArchived && becomingActive && !product.published_at) add("published_at", new Date());
    if (wasArchived && !becomingActive) add("published_at", null);
  }

  values.push(tenantId);
  values.push(product.id);
  await db.query(
    `UPDATE products SET ${sets.join(", ")}, updated_at = now() WHERE tenant_id = $${values.length - 1} AND id = $${values.length}`,
    values,
  );

  if (input.variants !== undefined) await replaceVariants(db, tenantId, product.id, input.variants);
  if (input.images !== undefined) await replaceImages(db, tenantId, product.id, input.images);
  if (input.seo !== undefined) await upsertSeo(db, tenantId, product.id, input.seo);
  if (input.collectionIds !== undefined) await setCollections(db, tenantId, product.id, input.collectionIds);

  const updated = await findProductById(db, tenantId, product.id);
  if (!updated) throw new Error("Product vanished during update");
  return loadProductDetail(db, tenantId, updated);
}

export async function archiveProduct(db: Db, tenantId: string, id: string): Promise<void> {
  await db.query(
    `UPDATE products SET status = 'archived', published_at = NULL, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
}

export async function setProductStatus(db: Db, tenantId: string, id: string, status: "active" | "draft"): Promise<void> {
  await db.query(
    `UPDATE products SET status = $3::product_status,
       published_at = CASE WHEN $3::text = 'active' THEN coalesce(published_at, now()) ELSE NULL END,
       updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, status],
  );
}

async function replaceVariants(
  db: Db,
  tenantId: string,
  productId: string,
  variants: ProductCreateInput["variants"],
): Promise<void> {
  await db.query("DELETE FROM variants WHERE tenant_id = $1 AND product_id = $2", [tenantId, productId]);
  let position = 0;
  for (const v of variants) {
    const { rows } = await db.query<VariantRow>(
      `INSERT INTO variants (tenant_id, product_id, title, sku, barcode, price_amount, compare_at_price, weight_g, option_values, position, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        tenantId,
        productId,
        v.title,
        v.sku,
        v.barcode ?? null,
        v.priceAmount,
        v.compareAtPrice ?? null,
        v.weightG ?? null,
        JSON.stringify(v.optionValues ?? {}),
        v.position ?? position,
        v.isDefault ?? position === 0,
      ],
    );
    const variant = rows[0]!;
    await upsertInventory(db, tenantId, variant.id, v.inventoryQty ?? 0);
    position += 1;
  }
}

async function replaceImages(
  db: Db,
  tenantId: string,
  productId: string,
  images: ProductCreateInput["images"],
): Promise<void> {
  await db.query("DELETE FROM product_images WHERE tenant_id = $1 AND product_id = $2", [tenantId, productId]);
  for (const img of images) {
    await db.query(
      `INSERT INTO product_images (tenant_id, product_id, url, alt, position)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, productId, img.url, img.alt ?? null, img.position ?? 0],
    );
  }
}

async function upsertInventory(db: Db, tenantId: string, variantId: string, quantity: number): Promise<void> {
  await db.query(
    `INSERT INTO inventory (tenant_id, variant_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
    [tenantId, variantId, quantity],
  );
}

async function upsertSeo(db: Db, tenantId: string, productId: string, seo: NonNullable<ProductUpdateInput["seo"]>): Promise<void> {
  await db.query(
    `INSERT INTO product_seo (tenant_id, product_id, meta_title, meta_description, keywords, og_title, og_description, canonical_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, product_id) DO UPDATE SET
       meta_title = EXCLUDED.meta_title,
       meta_description = EXCLUDED.meta_description,
       keywords = EXCLUDED.keywords,
       og_title = EXCLUDED.og_title,
       og_description = EXCLUDED.og_description,
       canonical_url = EXCLUDED.canonical_url,
       updated_at = now()`,
    [
      tenantId,
      productId,
      seo.metaTitle ?? null,
      seo.metaDescription ?? null,
      seo.keywords ?? [],
      seo.ogTitle ?? null,
      seo.ogDescription ?? null,
      seo.canonicalUrl ?? null,
    ],
  );
}

async function setCollections(db: Db, tenantId: string, productId: string, collectionIds: string[]): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM collections WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, collectionIds],
  );
  const valid = new Set(rows.map((r) => r.id));
  const allowed = collectionIds.filter((id) => valid.has(id));
  await db.query(
    "DELETE FROM product_collection WHERE product_id IN (SELECT id FROM products WHERE tenant_id = $1) AND product_id = $2 AND collection_id <> ALL($3::uuid[])",
    [tenantId, productId, allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"]],
  );
  for (const collectionId of allowed) {
    await db.query(
      `INSERT INTO product_collection (product_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [productId, collectionId],
    );
  }
}