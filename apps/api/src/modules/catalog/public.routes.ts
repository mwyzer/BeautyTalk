import { Router } from "express";
import type { Db } from "@beautyai/db";
import { resolveTenant } from "../../middleware/tenant.js";
import { ApiError } from "../../lib/http.js";
import {
  findProductByHandle,
  listProducts,
  loadProductDetail,
} from "../../repositories/products.repo.js";
import {
  findCollectionByHandle,
  listCollectionProducts,
  listCollections,
  loadCollectionDetail,
} from "../../repositories/collections.repo.js";

function parsePage(req: { query: Record<string, unknown> }): { page: number; limit: number } {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 25);
  return { page: Number.isFinite(page) ? Math.max(1, page) : 1, limit: Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 25 };
}

export function createPublicProductsRouter(db: Db): Router {
  const router = Router();
  router.use(resolveTenant(db));

  router.get("/", async (req, res) => {
    const tenantId = req.tenant!.id;
    const { page, limit } = parsePage(req);
    const sort = typeof req.query.sort === "string" ? req.query.sort : undefined;
    const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : undefined;
    const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
    const productType = typeof req.query.productType === "string" ? req.query.productType : undefined;
    const collection = typeof req.query.collection === "string" ? req.query.collection : undefined;

    const { data, total } = await listProducts(db, tenantId, {
      q,
      tag,
      productType,
      collection,
      page,
      limit,
      sort,
    });
    const products = await Promise.all(data.map((p) => loadProductDetail(db, tenantId, p)));
    const onlyActive = products.filter((p) => p.status === "active" && p.variants.length > 0);
    res.json({
      data: onlyActive.map(({ attributes: _a, ...p }) => p),
      meta: { page, limit, total },
    });
  });

  router.get("/:handle", async (req, res) => {
    const tenantId = req.tenant!.id;
    const product = await findProductByHandle(db, tenantId, String(req.params.handle));
    if (!product) throw ApiError.notFound("Product not found");
    const detail = await loadProductDetail(db, tenantId, product);
    if (detail.status !== "active") throw ApiError.notFound("Product not found");
    res.json({ data: detail });
  });

  return router;
}

export function createPublicCollectionsRouter(db: Db): Router {
  const router = Router();
  router.use(resolveTenant(db));

  router.get("/", async (req, res) => {
    const rows = await listCollections(db, req.tenant!.id, { publishedOnly: true });
    res.json({ data: rows.map(({ product_count, ...r }) => ({ ...r, productCount: product_count ?? 0 })) });
  });

  router.get("/:handle", async (req, res) => {
    const tenantId = req.tenant!.id;
    const collection = await findCollectionByHandle(db, tenantId, String(req.params.handle));
    if (!collection) throw ApiError.notFound("Collection not found");
    const detail = await loadCollectionDetail(db, tenantId, collection);
    if (!detail.published) throw ApiError.notFound("Collection not found");
    res.json({ data: detail });
  });

  router.get("/:handle/products", async (req, res) => {
    const tenantId = req.tenant!.id;
    const collection = await findCollectionByHandle(db, tenantId, String(req.params.handle));
    if (!collection) throw ApiError.notFound("Collection not found");
    const products = await listCollectionProducts(db, tenantId, collection.id);
    const detail = await Promise.all(products.map((p) => loadProductDetail(db, tenantId, p)));
    res.json({ data: detail });
  });

  return router;
}