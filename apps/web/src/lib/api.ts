import type { Cart, CollectionDetail, CollectionSummary, Product, ProductImage } from "@beautyai/shared";

// The browser follows the build-time PUBLIC_API_URL (baked in), but during
// SSR the container must reach the API over the docker network, so allow a
// runtime override (API_INTERNAL_URL) that only server-side code sees.
export const API_URL = (
  import.meta.env.SSR
    ? (process.env.API_INTERNAL_URL as string | undefined)
    : (import.meta.env.PUBLIC_API_URL as string | undefined)
) ?? "http://localhost:4000";
export const STORE_SLUG = (import.meta.env.PUBLIC_STORE_SLUG as string | undefined) ?? "glow-co";
export const STOREFRONT_URL = (import.meta.env.PUBLIC_STOREFRONT_URL as string | undefined) ?? "http://localhost:4321";

function baseHeaders(extra?: Record<string, string>): HeadersInit {
  return { "X-Tenant-Slug": STORE_SLUG, ...extra };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: baseHeaders() });
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  const body = (await res.json()) as { data: T };
  return body.data as T;
}

export async function fetchProducts(params?: Record<string, string | number>): Promise<{ data: Product[]; total: number }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) qs.set(k, String(v));
  const q = qs.toString();
  const res = await fetch(`${API_URL}/api/v1/products${q ? `?${q}` : ""}`, { headers: baseHeaders() });
  if (!res.ok) throw new Error(`API ${res.status} for /products`);
  return (await res.json()) as { data: Product[]; total: number };
}

export async function fetchProductByHandle(handle: string): Promise<Product | null> {
  try {
    return await getJson<Product>(`/api/v1/products/${handle}`);
  } catch {
    return null;
  }
}

export async function fetchCollections(): Promise<CollectionSummary[]> {
  return getJson<CollectionSummary[]>(`/api/v1/collections`);
}

export async function fetchCollectionByHandle(handle: string): Promise<CollectionDetail | null> {
  try {
    return await getJson<CollectionDetail>(`/api/v1/collections/${handle}`);
  } catch {
    return null;
  }
}

export async function fetchCollectionProducts(handle: string): Promise<Product[]> {
  return getJson<Product[]>(`/api/v1/collections/${handle}/products`);
}

export function productImage(product: { images?: ProductImage[] }): string | null {
  return product.images?.[0]?.url ?? null;
}

export function productDefaultPrice(product: Product): number | null {
  return product.variants[0]?.priceAmount ?? null;
}

export function isNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.includes("API 404");
}

export function storefrontAbsolute(path: string): string {
  return `${STOREFRONT_URL}${path}`;
}

export function productUrl(handle: string): string {
  return `/products/${handle}`;
}

export function collectionUrl(handle: string): string {
  return `/collections/${handle}`;
}

export type CartApi = {
  create: () => Promise<Cart>;
  get: (id: string) => Promise<Cart>;
  addItem: (id: string, variantId: string, quantity: number) => Promise<Cart>;
  updateItem: (id: string, itemId: string, quantity: number) => Promise<Cart>;
  removeItem: (id: string, itemId: string) => Promise<Cart>;
};

export function createCartApi(): CartApi {
  const api = API_URL;
  const headers = baseHeaders({ "Content-Type": "application/json" });
  return {
    async create(): Promise<Cart> {
      const res = await fetch(`${api}/api/v1/carts`, { method: "POST", headers });
      return ((await res.json()) as { data: Cart }).data;
    },
    async get(id: string): Promise<Cart> {
      const res = await fetch(`${api}/api/v1/carts/${id}`, { headers: baseHeaders() });
      if (!res.ok) throw new Error("cart not found");
      return ((await res.json()) as { data: Cart }).data;
    },
    async addItem(id: string, variantId: string, quantity: number): Promise<Cart> {
      const res = await fetch(`${api}/api/v1/carts/${id}/items`, {
        method: "POST",
        headers,
        body: JSON.stringify({ variantId, quantity }),
      });
      if (!res.ok) throw new Error("add item failed");
      return ((await res.json()) as { data: Cart }).data;
    },
    async updateItem(id: string, itemId: string, quantity: number): Promise<Cart> {
      const res = await fetch(`${api}/api/v1/carts/${id}/items/${itemId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ quantity }),
      });
      if (!res.ok) throw new Error("update item failed");
      return ((await res.json()) as { data: Cart }).data;
    },
    async removeItem(id: string, itemId: string): Promise<Cart> {
      const res = await fetch(`${api}/api/v1/carts/${id}/items/${itemId}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("remove item failed");
      return ((await res.json()) as { data: Cart }).data;
    },
  };
}