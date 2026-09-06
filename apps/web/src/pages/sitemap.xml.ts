import type { APIRoute } from "astro";
import { fetchCollections, fetchProducts, storefrontAbsolute } from "../lib/api";

export const GET: APIRoute = async () => {
  const urls: Array<{ loc: string; lastmod?: string }> = [
    { loc: storefrontAbsolute("/") },
    { loc: storefrontAbsolute("/search") },
  ];

  try {
    const pages = 3;
    for (let page = 1; page <= pages; page += 1) {
      const res = await fetchProducts({ page, limit: 100 });
      for (const p of res.data) {
        urls.push({
          loc: storefrontAbsolute(`/products/${p.handle}`),
          lastmod: p.updatedAt,
        });
        if ((res.total || 0) <= page * 100) break;
      }
    }
  } catch {
    // catalog unreachable is fine — sitemap still emits static URLs
  }

  try {
    const collections = await fetchCollections();
    for (const c of collections) urls.push({ loc: storefrontAbsolute(`/collections/${c.handle}`) });
  } catch {
    // ignore
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ""}
  </url>`,
  )
  .join("\n")}
</urlset>`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};