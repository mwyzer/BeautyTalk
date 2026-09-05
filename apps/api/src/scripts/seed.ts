import "dotenv/config";
import type { Db } from "@beautyai/db";
import { createPool, runMigrations } from "@beautyai/db";
import { createConfig } from "../config/env.js";
import { createAuthService } from "../modules/auth/index.js";

const config = createConfig();

interface SeedCatalogItem {
  title: string;
  handle: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  attributes: Record<string, string[]>;
  variants: Array<{ title: string; sku: string; price: number; compareAt?: number; qty: number }>;
  metaTitle?: string;
  metaDescription?: string;
  collections: string[];
  imageAlt: string;
}

const GLOW_CATALOG: SeedCatalogItem[] = [
  {
    title: "Vitamin C Brightening Serum",
    handle: "vitamin-c-brightening-serum",
    description: "A silky 15% vitamin C serum that fades dark spots and restores radiance.",
    productType: "Serums",
    vendor: "Glow Co.",
    tags: ["vitamin-c", "brightening", "serum"],
    attributes: { skin_type: ["all"], benefits: ["brightening"], key_ingredients: ["vitamin-c"] },
    variants: [{ title: "30ml", sku: "VC-SERUM-30", price: 4500, compareAt: 5500, qty: 120 }],
    metaTitle: "Vitamin C Brightening Serum | Glow Co.",
    metaDescription: "Dermatologist-grade 15% vitamin C serum for brighter, even skin. 30ml.",
    collections: ["Serums"],
    imageAlt: "Vitamin C Brightening Serum bottle",
  },
  {
    title: "Retinol Renewal Night Cream",
    handle: "retinol-renewal-night-cream",
    description: "Time-released retinol cream that smooths fine lines while you sleep.",
    productType: "Moisturizers",
    vendor: "Glow Co.",
    tags: ["retinol", "night-cream", "anti-aging"],
    attributes: { skin_type: ["dry", "normal"], benefits: ["anti-aging"], key_ingredients: ["retinol"] },
    variants: [
      { title: "50ml", sku: "RET-NIGHT-50", price: 5200, qty: 80 },
      { title: "100ml", sku: "RET-NIGHT-100", price: 8400, compareAt: 9200, qty: 40 },
    ],
    metaTitle: "Retinol Renewal Night Cream | Glow Co.",
    metaDescription: "Anti-aging retinol night cream with time-release delivery. 50ml & 100ml.",
    collections: ["Moisturizers"],
    imageAlt: "Retinol Renewal Night Cream jar",
  },
  {
    title: "Hyaluronic Acid Hydrating Toner",
    handle: "hyaluronic-acid-hydrating-toner",
    description: "Weightless hyaluronic acid toner for an instant surge of hydration.",
    productType: "Toners",
    vendor: "Glow Co.",
    tags: ["hyaluronic-acid", "toner", "hydration"],
    attributes: { skin_type: ["all"], benefits: ["hydration"], key_ingredients: ["hyaluronic-acid"] },
    variants: [{ title: "200ml", sku: "HA-TONER-200", price: 2800, qty: 200 }],
    metaTitle: "Hyaluronic Acid Hydrating Toner | Glow Co.",
    metaDescription: "Plumping hyaluronic acid toner for all skin types. Alcohol-free. 200ml.",
    collections: ["Toners", "Test Collection"],
    imageAlt: "Hyaluronic Acid Toner pump bottle",
  },
  {
    title: "Charcoal Clarifying Clay Mask",
    handle: "charcoal-clarifying-clay-mask",
    description: "Detoxifying kaolin and charcoal mask that unclogs pores in 10 minutes.",
    productType: "Masks",
    vendor: "Glow Co.",
    tags: ["charcoal", "clay-mask", "detox"],
    attributes: { skin_type: ["oily", "combination"], benefits: ["detox"], key_ingredients: ["charcoal"] },
    variants: [{ title: "100ml", sku: "CLAY-MASK-100", price: 2400, qty: 90 }],
    metaTitle: "Charcoal Clarifying Clay Mask | Glow Co.",
    metaDescription: "Kaolin and charcoal pore-clearing clay mask for oily skin. 100ml.",
    collections: ["Test Collection"],
    imageAlt: "Charcoal Clay Mask tub",
  },
];

async function ensurePlans(db: Db): Promise<void> {
  const plans: Array<{ code: string; name: string; monthly: number; yearly: number | null; features: object }> = [
    { code: "starter", name: "Starter", monthly: 4900, yearly: 47040, features: { content_credits: 50, crawl_frequency: "weekly", stores: 1, api_access: false } },
    { code: "growth", name: "Growth", monthly: 14900, yearly: 143040, features: { content_credits: -1, crawl_frequency: "daily", stores: 1, api_access: false } },
    { code: "scale", name: "Scale", monthly: 39900, yearly: 383040, features: { content_credits: -1, crawl_frequency: "daily", stores: 3, api_access: true } },
  ];
  for (const p of plans) {
    await db.query(
      `INSERT INTO plans (code, name, price_monthly, price_yearly, features)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO NOTHING`,
      [p.code, p.name, p.monthly, p.yearly, JSON.stringify(p.features)],
    );
  }
}

async function seedCatalog(db: Db, tenantId: string): Promise<void> {
  const { rows } = await db.query<{ id: string; title: string }>(
    `INSERT INTO collections (tenant_id, title, handle, description, published)
     VALUES
       ($1, 'Serums', 'serums', 'Lightweight actives.', true),
       ($1, 'Moisturizers', 'moisturizers', 'Daily hydration.', true),
       ($1, 'Toners', 'toners', 'Prep and refresh.', true),
       ($1, 'Test Collection', 'test-collection', 'Auto-generated collection.', true)
     ON CONFLICT (tenant_id, handle) DO NOTHING
     RETURNING id, title`,
    [tenantId],
  );

  const collectionsByTitle = new Map(rows.map((r) => [r.title, r.id]));

  for (const item of GLOW_CATALOG) {
    const { rows: productRows } = await db.query<{ id: string }>(
      `INSERT INTO products (tenant_id, title, handle, description, status, vendor, product_type, tags, attributes, published_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, now())
       ON CONFLICT (tenant_id, handle) DO NOTHING
       RETURNING id`,
      [
        tenantId,
        item.title,
        item.handle,
        item.description,
        item.vendor,
        item.productType,
        item.tags,
        JSON.stringify(item.attributes),
      ],
    );
    const productId = productRows[0]?.id;
    if (!productId) continue;

    for (const v of item.variants) {
      const { rows: variantRows } = await db.query<{ id: string }>(
        `INSERT INTO variants (tenant_id, product_id, title, sku, price_amount, compare_at_price, option_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, sku) DO NOTHING
         RETURNING id`,
        [
          tenantId,
          productId,
          v.title,
          v.sku,
          v.price,
          v.compareAt ?? null,
          JSON.stringify({ size: v.title }),
        ],
      );
      const variantId = variantRows[0]?.id;
      if (variantId) {
        await db.query(
          `INSERT INTO inventory (tenant_id, variant_id, quantity, tracked, low_stock_threshold)
           VALUES ($1, $2, $3, true, 10)
           ON CONFLICT (tenant_id, variant_id) DO NOTHING`,
          [tenantId, variantId, v.qty],
        );
      }
    }

    await db.query(
      `INSERT INTO product_images (tenant_id, product_id, url, alt, position)
       VALUES ($1, $2, $3, $4, 0)`,
      [tenantId, productId, `https://cdn.example.com/${item.handle}.jpg`, item.imageAlt],
    );

    await db.query(
      `INSERT INTO product_seo (tenant_id, product_id, meta_title, meta_description, keywords)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, product_id) DO NOTHING`,
      [
        tenantId,
        productId,
        item.metaTitle ?? `${item.title} | ${"Glow Co."}`,
        item.metaDescription ?? item.description,
        item.tags,
      ],
    );

    for (const collectionTitle of item.collections) {
      const collectionId = collectionsByTitle.get(collectionTitle);
      if (collectionId) {
        await db.query(
          `INSERT INTO product_collection (product_id, collection_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [productId, collectionId],
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const db = createPool({ connectionString: config.DATABASE_URL });
  try {
    const applied = await runMigrations(db);
    console.log(applied.length > 0 ? `applied migrations: ${applied.join(", ")}` : "migrations up to date");

    await ensurePlans(db);

    const auth = createAuthService(db, config);
    const demoBrands: Array<{ storeName: string; email: string; password: string; fullName: string }> = [
      { storeName: "Glow Co.", email: "demo@glow.co", password: "Password123!", fullName: "Maya Demo" },
      { storeName: "Luxe Labs", email: "luxe@luxe.test", password: "Password123!", fullName: "Dev Lux" },
    ];

    for (const brand of demoBrands) {
      const existingUser = await db.query("SELECT id FROM users WHERE email = $1", [brand.email]);
      if (existingUser.rowCount) {
        console.log(`user ${brand.email} already exists, skipping`);
        continue;
      }
      const res = await auth.register(
        { storeName: brand.storeName, email: brand.email, password: brand.password, fullName: brand.fullName },
        "seed",
      );
      if (brand.storeName === "Glow Co.") {
        const { rows } = await db.query<{ id: string }>(
          "UPDATE tenants SET status = 'active' WHERE id = $1 RETURNING id",
          [res.tenant.id],
        );
        const tenantId = rows[0]!.id;
        await db.query(
          `INSERT INTO brand_tones (tenant_id, name, voice, language)
           VALUES ($1, 'Warm + Evidence-based', 'Warm, natural, evidence-based, never overpromises.', 'en')
           ON CONFLICT (tenant_id) DO NOTHING`,
          [tenantId],
        );
        const { rows: planRows } = await db.query<{ id: string }>(
          "SELECT id FROM plans WHERE code = 'growth'",
        );
        await db.query(
          `INSERT INTO subscriptions (tenant_id, plan_id, status) VALUES ($1, $2, 'active') ON CONFLICT (tenant_id) DO NOTHING`,
          [tenantId, planRows[0]!.id],
        );
        await db.query(
          `INSERT INTO feature_quotas (tenant_id, feature, used, quota_limit) VALUES
             ($1, 'content_credits', 0, -1),
             ($1, 'crawl_frequency', 0, 0)
           ON CONFLICT (tenant_id, feature) DO NOTHING`,
          [tenantId],
        );
        await seedCatalog(db, tenantId);
      }
      console.log(`seeded tenant: ${brand.storeName} (${brand.email} / ${brand.password})`);
    }
    console.log("seed complete");
  } finally {
    await db.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});