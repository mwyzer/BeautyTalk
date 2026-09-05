import { Router } from "express";
import type { DbPool, Queryable } from "@beautyai/db";
import { productCreateSchema, productUpdateSchema, collectionCreateSchema, collectionUpdateSchema } from "@beautyai/shared";
import { validateBody } from "../../middleware/validate.js";
import { ApiError } from "../../lib/http.js";
import {
  archiveProduct,
  createProduct,
  findProductById,
  listProducts,
  loadProductDetail,
  setProductStatus,
  updateProduct,
} from "../../repositories/products.repo.js";
import {
  addProductToCollection,
  createCollection,
  deleteCollection,
  findCollectionById,
  listCollections,
  loadCollectionDetail,
  removeProductFromCollection,
  updateCollection,
} from "../../repositories/collections.repo.js";
import { writeAuditLog } from "../../repositories/audit-logs.repo.js";

async function inTx(db: DbPool, fn: (client: Queryable) => Promise<void>): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function createAdminCatalogRouter(db: DbPool): Router {
  const router = Router();

  // ===== Products =====

  router.get("/products", async (req, res) => {
    const tenantId = req.ctx!.tenantId;
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 25);
    const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const { data, total } = await listProducts(db, tenantId, {
      q,
      includeArchived: true,
      page,
      limit,
      sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
    });
    const products = await Promise.all(
      (status ? data.filter((p) => p.status === status) : data).map((p) => loadProductDetail(db, tenantId, p)),
    );
    res.json({ data: products, meta: { page, limit, total } });
  });

  router.post("/products", validateBody(productCreateSchema), async (req, res) => {
    const ctx = req.ctx!;
    let created;
    await inTx(db, async (client) => {
      created = await createProduct(client, ctx.tenantId, req.body);
    });
    await writeAuditLog(db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "product.create",
      resourceType: "product",
      resourceId: created!.id,
      after: { handle: created!.handle },
    });
    res.status(201).json({ data: created });
  });

  router.get("/products/:id", async (req, res) => {
    const product = await findProductById(db, req.ctx!.tenantId, String(req.params.id));
    if (!product) throw ApiError.notFound("Product not found");
    res.json({ data: await loadProductDetail(db, req.ctx!.tenantId, product) });
  });

  router.patch("/products/:id", validateBody(productUpdateSchema), async (req, res) => {
    const ctx = req.ctx!;
    const product = await findProductById(db, ctx.tenantId, String(req.params.id));
    if (!product) throw ApiError.notFound("Product not found");
    let updated;
    await inTx(db, async (client) => {
      updated = await updateProduct(client, ctx.tenantId, product, req.body);
    });
    await writeAuditLog(db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "product.update",
      resourceType: "product",
      resourceId: product.id,
      after: { title: updated!.title, status: updated!.status },
    });
    res.json({ data: updated });
  });

  router.delete("/products/:id", async (req, res) => {
    const ctx = req.ctx!;
    const product = await findProductById(db, ctx.tenantId, String(req.params.id));
    if (!product) throw ApiError.notFound("Product not found");
    await archiveProduct(db, ctx.tenantId, product.id);
    await writeAuditLog(db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "product.archive",
      resourceType: "product",
      resourceId: product.id,
    });
    res.status(204).end();
  });

  router.post("/products/:id/publish", async (req, res) => {
    const ctx = req.ctx!;
    const status = req.body?.status === "draft" ? "draft" : "active";
    const product = await findProductById(db, ctx.tenantId, String(req.params.id));
    if (!product) throw ApiError.notFound("Product not found");
    if (product.status === "archived") throw ApiError.conflict("Archived products cannot be published");
    await setProductStatus(db, ctx.tenantId, product.id, status);
    await writeAuditLog(db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "product.publish",
      resourceType: "product",
      resourceId: product.id,
      after: { status },
    });
    res.json({ data: { status } });
  });

  // ===== Collections =====

  router.get("/collections", async (req, res) => {
    const rows = await listCollections(db, req.ctx!.tenantId);
    res.json({
      data: rows.map(({ product_count, ...r }) => ({ ...r, productCount: product_count ?? 0 })),
    });
  });

  router.get("/collections/:id", async (req, res) => {
    const collection = await findCollectionById(db, req.ctx!.tenantId, String(req.params.id));
    if (!collection) throw ApiError.notFound("Collection not found");
    res.json({ data: await loadCollectionDetail(db, req.ctx!.tenantId, collection) });
  });

  router.post("/collections", validateBody(collectionCreateSchema), async (req, res) => {
    const collection = await createCollection(db, req.ctx!.tenantId, req.body);
    res.status(201).json({ data: collection });
  });

  router.patch("/collections/:id", validateBody(collectionUpdateSchema), async (req, res) => {
    const collection = await updateCollection(db, req.ctx!.tenantId, String(req.params.id), req.body);
    res.json({ data: collection });
  });

  router.delete("/collections/:id", async (req, res) => {
    await deleteCollection(db, req.ctx!.tenantId, String(req.params.id));
    res.status(204).end();
  });

  router.post("/collections/:id/products/:productId", async (req, res) => {
    const ctx = req.ctx!;
    const collection = await findCollectionById(db, ctx.tenantId, String(req.params.id));
    if (!collection) throw ApiError.notFound("Collection not found");
    const product = await findProductById(db, ctx.tenantId, String(req.params.productId));
    if (!product) throw ApiError.notFound("Product not found");
    await addProductToCollection(db, ctx.tenantId, collection.id, product.id);
    res.status(204).end();
  });

  router.delete("/collections/:id/products/:productId", async (req, res) => {
    await removeProductFromCollection(db, req.ctx!.tenantId, String(req.params.id), String(req.params.productId));
    res.status(204).end();
  });

  return router;
}