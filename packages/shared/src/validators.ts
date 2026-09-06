import { z } from "zod";

const slugPattern = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export const registerSchema = z.object({
  storeName: z
    .string()
    .trim()
    .min(2, "storeName must be at least 2 characters")
    .max(80, "storeName must be at most 80 characters"),
  email: z.string().trim().toLowerCase().email("email must be a valid email address"),
  password: z
    .string()
    .min(8, "password must be at least 8 characters")
    .max(128, "password must be at most 128 characters"),
  fullName: z.string().trim().min(1, "fullName is required").max(120),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("email must be a valid email address"),
  password: z.string().min(1, "password is required").max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, "refreshToken is required"),
});

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("email must be a valid email address"),
  role: z.enum(["owner", "editor", "viewer"]),
  fullName: z.string().trim().max(120).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;

export const createTenantSlug = (storeName: string): string => {
  const slug = storeName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  if (!slugPattern.test(slug)) return `store-${Date.now().toString(36)}`;
  return slug;
};

const handlePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createHandle = (title: string): string => {
  const handle = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return handlePattern.test(handle) ? handle : `product-${Date.now().toString(36)}`;
};

// ===== Catalog =====

const variantSchema = z.object({
  title: z.string().trim().min(1, "variant title is required").max(120),
  sku: z.string().trim().min(1, "sku is required").max(64),
  barcode: z.string().trim().max(64).optional().nullable(),
  priceAmount: z.number().int().min(0, "price must be >= 0"),
  compareAtPrice: z.number().int().min(0).optional().nullable(),
  weightG: z.number().int().min(0).optional().nullable(),
  optionValues: z.record(z.string()).optional().default({}),
  position: z.number().int().min(0).optional().default(0),
  isDefault: z.boolean().optional().default(false),
  inventoryQty: z.number().int().min(0).optional().default(0),
});

export const productCreateSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(160),
  handle: z.string().trim().regex(handlePattern, "handle must be a slug like my-product").optional(),
  description: z.string().max(5000).optional().nullable(),
  bodyHtml: z.string().max(100_000).optional().nullable(),
  status: z.enum(["draft", "active", "archived"]).optional().default("draft"),
  vendor: z.string().max(120).optional().nullable(),
  productType: z.string().max(120).optional().nullable(),
  tags: z.array(z.string().trim().min(1)).max(50).optional().default([]),
  attributes: z.record(z.unknown()).optional().default({}),
  variants: z.array(variantSchema).min(1, "at least one variant is required"),
  images: z
    .array(
      z.object({
        url: z.string().url("image url must be a valid URL"),
        alt: z.string().max(300).optional().nullable(),
        position: z.number().int().min(0).optional().default(0),
      }),
    )
    .max(20)
    .optional()
    .default([]),
  seo: z
    .object({
      metaTitle: z.string().max(60, "metaTitle must be 60 characters or fewer").optional().nullable(),
      metaDescription: z.string().max(160, "metaDescription must be 160 characters or fewer").optional().nullable(),
      keywords: z.array(z.string().trim().min(1)).max(50).optional().default([]),
      ogTitle: z.string().max(100).optional().nullable(),
      ogDescription: z.string().max(200).optional().nullable(),
      canonicalUrl: z.string().url().optional().nullable(),
    })
    .optional(),
  collectionIds: z.array(z.string().uuid()).max(50).optional().default([]),
});

export const productUpdateSchema = productCreateSchema.partial().extend({
  variants: z.array(variantSchema).min(0).optional(),
  images: z
    .array(
      z.object({
        url: z.string().url(),
        alt: z.string().max(300).optional().nullable(),
        position: z.number().int().min(0).optional().default(0),
      }),
    )
    .max(20)
    .optional(),
});

export const collectionCreateSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(120),
  handle: z.string().trim().regex(handlePattern).optional(),
  description: z.string().max(2000).optional().nullable(),
  rule: z.record(z.unknown()).optional().nullable(),
  sortOrder: z.enum(["manual", "created", "price"]).optional().default("manual"),
  published: z.boolean().optional().default(true),
  imageUrl: z.string().url().optional().nullable(),
});

export const collectionUpdateSchema = collectionCreateSchema.partial();

// ===== Cart & Checkout =====

export const addCartItemSchema = z.object({
  variantId: z.string().uuid("variantId must be a valid id"),
  quantity: z.number().int().min(1).max(99),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(0).max(99, "quantity must be between 0 and 99"),
});

// ===== Customers =====

export const customerRegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email("email must be a valid email address"),
  password: z.string().min(8, "password must be at least 8 characters").max(128),
  firstName: z.string().trim().max(120).optional().nullable(),
  lastName: z.string().trim().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
});

export const customerLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("email must be a valid email address"),
  password: z.string().min(1, "password is required").max(128),
});

export const addressCreateSchema = z.object({
  label: z.string().trim().max(40).optional().nullable(),
  firstName: z.string().trim().max(120).optional().nullable(),
  lastName: z.string().trim().max(120).optional().nullable(),
  address1: z.string().trim().min(1, "address1 is required").max(200),
  address2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1, "city is required").max(120),
  province: z.string().trim().max(120).optional().nullable(),
  zip: z.string().trim().min(1, "zip is required").max(20),
  country: z.string().trim().min(1, "country is required").max(120),
  phone: z.string().max(40).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
});

export const addressUpdateSchema = addressCreateSchema.partial();

// ===== Orders =====

export const orderUpdateSchema = z.object({
  status: z.enum(["pending", "paid", "fulfilled", "shipped", "delivered", "cancelled", "refunded"]).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export const fulfillOrderSchema = z.object({
  carrier: z.string().trim().min(1, "carrier is required").max(120),
  trackingNumber: z.string().trim().max(200).optional().nullable(),
});

export const refundOrderSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type CollectionCreateInput = z.infer<typeof collectionCreateSchema>;
export type CollectionUpdateInput = z.infer<typeof collectionUpdateSchema>;
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;
export type AddressCreateInput = z.infer<typeof addressCreateSchema>;
export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>;
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;
export type FulfillOrderInput = z.infer<typeof fulfillOrderSchema>;
export type RefundOrderInput = z.infer<typeof refundOrderSchema>;

// ===== Content (Phase 2: AI Content Engine) =====

export const brandToneUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional().nullable(),
  voice: z.string().max(500).optional().nullable(),
  forbiddenWords: z.array(z.string().trim().min(1)).max(200).optional(),
  preferredTerms: z.record(z.string()).optional(),
  samplePhrases: z.array(z.string().trim().min(1)).max(50).optional(),
  language: z.string().trim().min(2).max(10).optional(),
});

export const contentGenerateSchema = z.object({
  type: z.enum(["product_description", "meta", "blog"]),
  targetIds: z.array(z.string().uuid("targetId must be a valid id")).min(1, "at least one target is required").max(50, "max 50 targets per request"),
  regenerate: z.boolean().optional().default(false),
});

export const draftUpdateSchema = z.object({
  title: z.string().trim().max(200).optional().nullable(),
  body: z.string().max(100_000).optional().nullable(),
  metaTitle: z.string().max(60, "metaTitle must be 60 characters or fewer").optional().nullable(),
  metaDescription: z.string().max(160, "metaDescription must be 160 characters or fewer").optional().nullable(),
  changeSummary: z.string().max(500).optional().nullable(),
});

export type BrandToneUpdateInput = z.infer<typeof brandToneUpdateSchema>;
export type ContentGenerateInput = z.infer<typeof contentGenerateSchema>;
export type DraftUpdateInput = z.infer<typeof draftUpdateSchema>;