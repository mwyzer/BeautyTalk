import type { APIRoute } from "astro";
import { storefrontAbsolute } from "../lib/api";

export const GET: APIRoute = async () => {
  const body = `User-agent: *
Allow: /

Sitemap: ${storefrontAbsolute("/sitemap.xml")}
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};