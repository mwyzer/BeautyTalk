import type { Db } from "@beautyai/db";
import type { CollectionCreateInput, CollectionUpdateInput } from "@beautyai/shared";
import { createHandle } from "@beautyai/shared";
import { loadProductDetail } from "./products.repo.js";

export interface CollectionRow {
  id: string;
  tenant_id: string;
  title: string;
  handle: string;
  description: string | null;
  rule: Record<string, unknown> | null;
  sort_order: string;
  published: boolean;
  image_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function listCollections(
  db: Db,
  tenantId: string,
  opts: { publishedOnly?: boolean; includeCount?: boolean } = {},
): Promise<Array<CollectionRow & { product_count?: number }>> {
  const { rows } = await db.query<CollectionRow & { product_count?: number }>(
    `SELECT c.*, COUNT(pc.product_id)::int AS product_count
     FROM collections c
     LEFT JOIN product_collection pc ON pc.collection_id = c.id
     WHERE c.tenant_id = $1${opts.publishedOnly ? " AND c.published = true" : ""}
     GROUP BY c.id
     ORDER BY c.created_at ASC`,
    [tenantId],
  );
  return opts.includeCount === false ? rows.map(({ product_count: _pc, ...r }) => r) : rows;
}

export async function findCollectionByHandle(db: Db, tenantId: string, handle: string): Promise<CollectionRow | null> {
  const { rows } = await db.query<CollectionRow>(
    "SELECT * FROM collections WHERE tenant_id = $1 AND handle = $2",
    [tenantId, handle],
  );
  return rows[0] ?? null;
}

export async function findCollectionById(db: Db, tenantId: string, id: string): Promise<CollectionRow | null> {
  const { rows } = await db.query<CollectionRow>(
    "SELECT * FROM collections WHERE tenant_id = $1 AND id = $2",
    [tenantId, id],
  );
  return rows[0] ?? null;
}

export async function listCollectionProducts(
  db: Db,
  tenantId: string,
  collectionId: string,
): Promise<import("./products.repo.js").ProductRow[]> {
  const { rows } = await db.query<import("./products.repo.js").ProductRow>(
    `SELECT p.id, p.tenant_id, p.title, p.handle, p.description, p.body_html, p.status, p.vendor,
       p.product_type, p.tags, p.attributes, p.template, p.published_at, p.created_at, p.updated_at
     FROM products p
     JOIN product_collection pc ON pc.product_id = p.id
     WHERE pc.collection_id = $1 AND p.tenant_id = $2 AND p.status = 'active'
     ORDER BY pc.position ASC, p.created_at ASC`,
    [collectionId, tenantId],
  );
  return rows;
}

export async function createCollection(db: Db, tenantId: string, input: CollectionCreateInput): Promise<CollectionRow> {
  const handle = input.handle ?? createHandle(input.title);
  const { rows } = await db.query<CollectionRow>(
    `INSERT INTO collections (tenant_id, title, handle, description, rule, sort_order, published, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      tenantId,
      input.title,
      handle,
      input.description ?? null,
      input.rule ? JSON.stringify(input.rule) : null,
      input.sortOrder ?? "manual",
      input.published ?? true,
      input.imageUrl ?? null,
    ],
  );
  return rows[0]!;
}

export async function updateCollection(
  db: Db,
  tenantId: string,
  id: string,
  input: CollectionUpdateInput,
): Promise<CollectionRow> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (col: string, val: unknown): void => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };
  if (input.title !== undefined) add("title", input.title);
  if (input.handle !== undefined) add("handle", input.handle);
  if (input.description !== undefined) add("description", input.description);
  if (input.rule !== undefined) add("rule", input.rule ? JSON.stringify(input.rule) : null);
  if (input.sortOrder !== undefined) add("sort_order", input.sortOrder);
  if (input.published !== undefined) add("published", input.published);
  if (input.imageUrl !== undefined) add("image_url", input.imageUrl);
  values.push(tenantId, id);
  await db.query(
    `UPDATE collections SET ${sets.join(", ")}, updated_at = now() WHERE tenant_id = $${values.length - 1} AND id = $${values.length}`,
    values,
  );
  const updated = await findCollectionById(db, tenantId, id);
  if (!updated) throw new Error("Collection vanished during update");
  return updated;
}

export async function deleteCollection(db: Db, tenantId: string, id: string): Promise<void> {
  await db.query("DELETE FROM collections WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
}

export async function addProductToCollection(db: Db, tenantId: string, collectionId: string, productId: string): Promise<void> {
  const exists = await db.query(
    `SELECT 1 FROM product_collection pc
     JOIN collections c ON c.id = pc.collection_id
     WHERE pc.product_id = $1 AND pc.collection_id = $2 AND c.tenant_id = $3`,
    [productId, collectionId, tenantId],
  );
  if (exists.rowCount) return;
  await db.query(
    `INSERT INTO product_collection (product_id, collection_id) VALUES ($1, $2)`,
    [productId, collectionId],
  );
}

export async function removeProductFromCollection(db: Db, tenantId: string, collectionId: string, productId: string): Promise<void> {
  await db.query(
    `DELETE FROM product_collection pc USING collections c
     WHERE pc.collection_id = c.id AND c.tenant_id = $1 AND pc.collection_id = $2 AND pc.product_id = $3`,
    [tenantId, collectionId, productId],
  );
}

export async function loadCollectionDetail(
  db: Db,
  tenantId: string,
  collection: CollectionRow,
): Promise<import("@beautyai/shared").CollectionDetail> {
  const products = await listCollectionProducts(db, tenantId, collection.id);
  const detail = await Promise.all(products.map((p) => loadProductDetail(db, tenantId, p)));
  return {
    id: collection.id,
    title: collection.title,
    handle: collection.handle,
    description: collection.description,
    imageUrl: collection.image_url,
    sortOrder: collection.sort_order,
    published: collection.published,
    rule: collection.rule,
    productCount: detail.length,
    products: detail,
  };
}