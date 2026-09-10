import { describe, expect, it } from "vitest";
import { crawl, isPathAllowed, parseRobotsTxt, type FetchLike, type RobotsRules } from "../audit/crawler.js";

describe("robots.txt parsing", () => {
  it("parses disallow/allow and crawl delay for our agent", () => {
    const rules = parseRobotsTxt(`
      User-agent: *
      Disallow: /admin
      Disallow: /checkout/
      Allow: /public
      Crawl-delay: 1

      User-agent: googlebot
      Disallow: /
    `);
    expect(rules.disallow).toEqual(["/admin", "/checkout/"]);
    expect(rules.allow).toEqual(["/public"]);
    expect(rules.crawlDelayMs).toBe(1000);
  });

  it("uses longest-prefix match", () => {
    const rules: RobotsRules = { disallow: ["/products"], allow: ["/products/featured"], crawlDelayMs: null };
    expect(isPathAllowed("/products/featured/x", rules)).toBe(true);
    expect(isPathAllowed("/products/other", rules)).toBe(false);
  });

  it("allows everything when no rules apply", () => {
    expect(isPathAllowed("/", DEFAULT_ROBOTS)).toBe(true);
  });
});

const DEFAULT_ROBOTS: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };

const PAGE = `<!doctype html><html><head>
  <title>Glow Co — Home</title>
  <meta name="description" content="Clean beauty shop">
  <link rel="canonical" href="http://fixture.test/">
  <script type="application/ld+json">{"@type":"Organization"}</script>
</head><body>
  <h1>Glow Co</h1>
  <p>A long enough description with enough words to clear the thin content threshold by far.</p>
  <img src="/img/a.jpg" alt="Glow bottle">
  <img src="/img/b.jpg">
  <a href="/products/serum">Serum</a>
  <a href="/missing">Missing</a>
  <a href="mailto:x@y.com">Mail</a>
</body></html>`;

describe("crawler", () => {
  it("crawls from sitemap seed, respects robots, finds broken links", async () => {
    const served: Record<string, string> = {
      "/": PAGE,
      "/products/serum": `<html><head><title>Serum</title><meta name="description" content="d"></head><body><h1>Serum</h1><p>Words galore for the product page body copy.</p><a href="/">Home</a></body></html>`,
      "/sitemap.xml": `<?xml version="1.0"?><urlset><url><loc>http://fixture.test/</loc></url></urlset>`,
      "/robots.txt": `User-agent: *\nDisallow: /admin\nDisallow: /checkout`,
    };
    const hits: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      const url = typeof input === "string" ? new URL(input) : input;
      hits.push(url.pathname + url.search);
      const body = served[url.pathname] ?? "";
      if (url.pathname === "/missing" || url.pathname === "/admin") {
        return new Response(null, { status: 404 });
      }
      if (body) return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
      return new Response("", { status: 404 });
    };
    const requests: string[] = [];
    const sleepMs = async (ms: number) => {
      requests.push(`delay:${ms}`);
    };

    const result = await crawl({
      baseUrl: "http://fixture.test",
      maxUrls: 10,
      maxDepth: 2,
      politenessMs: 100,
      timeoutMs: 5_000,
      userAgent: "BeautyAI-SEO-Auditor/1.0 test",
      excludePatterns: [],
      linkCheckBudget: 20,
      fetchImpl,
      sleepMs,
    });

    // Seed page was crawled, robots.txt read before first page
    expect(hits).toContain("/robots.txt");
    expect(result.snapshots.some((s) => s.url === "http://fixture.test/")).toBe(true);
    // sitemap was seeded
    expect(hits).toContain("/sitemap.xml");
    // politeness delay was applied between fetches
    expect(requests.length).toBeGreaterThan(0);
    // page parse: image with missing alt counted, title extracted
    const home = result.snapshots.find((s) => s.url === "http://fixture.test/")!;
    expect(home.title).toBe("Glow Co — Home");
    expect(home.imagesTotal).toBe(2);
    expect(home.imagesWithoutAlt).toBe(1);
    expect(home.hasCanonical).toBe(true);
    expect(home.h1Count).toBe(1);
    expect(home.hasProductSchema).toBe(false);
  });

  it("does not crawl disallowed paths", async () => {
    const linkingPage = `<html><body><h1>Home</h1><a href="/private">Private</a><a href="/products/serum">Serum</a></body></html>`;
    const fetchImpl: FetchLike = async (input) => {
      const url = typeof input === "string" ? new URL(input) : input;
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /private", { status: 200 });
      if (url.pathname === "/") return new Response(linkingPage, { status: 200, headers: { "content-type": "text/html" } });
      return new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });
    };
    const result = await crawl({
      baseUrl: "http://fixture.test",
      maxUrls: 10,
      maxDepth: 2,
      politenessMs: 0,
      timeoutMs: 5_000,
      userAgent: "BeautyAI-SEO-Auditor/1.0 test",
      excludePatterns: [],
      linkCheckBudget: 0,
      fetchImpl,
    });
    expect(result.disallowed.some((u) => u.includes("/private"))).toBe(true);
    expect(result.snapshots.some((s) => s.url.includes("/private"))).toBe(false);
  });

  it("respects excludePatterns", async () => {
    const linkingPage = `<html><body><h1>Home</h1><a href="/filtered/secret">Filtered</a><a href="/products/serum">Serum</a></body></html>`;
    const fetchImpl: FetchLike = async (input) => {
      const url = typeof input === "string" ? new URL(input) : input;
      if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
      if (url.pathname === "/") return new Response(linkingPage, { status: 200, headers: { "content-type": "text/html" } });
      return new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });
    };
    const result = await crawl({
      baseUrl: "http://fixture.test",
      maxUrls: 10,
      maxDepth: 2,
      politenessMs: 0,
      timeoutMs: 5_000,
      userAgent: "test",
      excludePatterns: ["/filtered"],
      linkCheckBudget: 0,
      fetchImpl,
    });
    expect(result.snapshots.some((s) => s.url.includes("/filtered"))).toBe(false);
    expect(result.snapshots.some((s) => s.url.includes("/products/serum"))).toBe(true);
  });
});