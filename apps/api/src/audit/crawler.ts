const TEXT_EXT_RE = /\.(?:js|css|json|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm|mp3|ogg|zip|gz|pdf|xml|txt)$/i;

export interface RobotsRules {
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
}

export const DEFAULT_ROBOTS: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };

export function parseRobotsTxt(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };
  let appliesToUs = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const commentIdx = rawLine.indexOf("#");
    const line = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    if (key === "user-agent") {
      appliesToUs = value === "*" || value.toLowerCase().includes("beautyai");
    } else if (!appliesToUs) {
      continue;
    } else if (key === "disallow") {
      rules.disallow.push(value);
    } else if (key === "allow") {
      rules.allow.push(value);
    } else if (key === "crawl-delay") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) rules.crawlDelayMs = Math.round(parsed * 1000);
    }
  }
  return rules;
}

export function isPathAllowed(path: string, rules: RobotsRules): boolean {
  if (!path.startsWith("/")) path = `/${path}`;
  const rule = (list: string[]): string | null => {
    let best: string | null = null;
    for (const entry of list) {
      if (entry === "" ) continue;
      if (path.startsWith(entry) && (best === null || entry.length > best.length)) best = entry;
    }
    return best;
  };
  const allow = rule(rules.allow);
  const disallow = rule(rules.disallow);
  if (allow === null && disallow === null) return true;
  return (allow ?? "") > (disallow ?? "");
}

export interface PageSnapshot {
  url: string;
  status: number | null;
  title: string | null;
  metaDescription: string | null;
  titleLength: number | null;
  metaDescriptionLength: number | null;
  h1Count: number;
  hasCanonical: boolean;
  isIndexable: boolean;
  wordCount: number;
  imagesTotal: number;
  imagesWithoutAlt: number;
  brokenLinks: number;
  hasProductSchema: boolean;
  internalLinks: string[];
  loadTimeMs: number;
  transferBytes: number;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type { FetchLike };

export interface CrawlOptions {
  baseUrl: string;
  maxUrls: number;
  maxDepth: number;
  politenessMs: number;
  timeoutMs: number;
  userAgent: string;
  excludePatterns: string[];
  linkCheckBudget: number;
  fetchImpl?: FetchLike;
  sleepMs?: (ms: number) => Promise<void>;
  onPage?: (snapshot: PageSnapshot, index: number, total: number) => Promise<void>;
}

export interface CrawlResult {
  snapshots: PageSnapshot[];
  robots: RobotsRules;
  disallowed: string[];
}

function sameOrigin(a: URL, b: URL): boolean {
  return a.host === b.host && a.protocol === b.protocol;
}

function isCrawlableUrl(candidate: URL, base: URL): boolean {
  if (!sameOrigin(candidate, base)) return false;
  if (candidate.origin !== base.origin) return false;
  if (candidate.hash) return false;
  const path = candidate.pathname;
  if (TEXT_EXT_RE.test(path)) return false;
  return true;
}

const META_DESCRIPTION_RE = /<meta[^>]+name=["']description["'][^>]*>/gi;
const META_ROBOTS_NOINDEX_RE = /<meta[^>]+name=["']robots["'][^>]*>/gi;
const LINK_CANONICAL_RE = /<link[^>]+rel=["']canonical["'][^>]*>/gi;
const SCRIPT_JSONLD_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const H1_RE = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
const IMG_RE = /<img\b[^>]*>/gi;
const ANCHOR_RE = /<a\b[^>]+href=["']([^"']+)["'][^>]*>/gi;

function attrValue(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const match = re.exec(tag);
  return match?.[1] ?? null;
}

function stripTagsAndDecode(raw: string): string {
  const withoutTags = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtml(html: string): {
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  canonical: boolean;
  indexable: boolean;
  wordCount: number;
  imagesTotal: number;
  imagesWithoutAlt: number;
  hasProductSchema: boolean;
  anchors: string[];
} {
  let title: string | null = null;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch?.[1]) title = stripTagsAndDecode(titleMatch[1]);

  let metaDescription: string | null = null;
  for (const tag of html.matchAll(META_DESCRIPTION_RE)) {
    const content = attrValue(tag[0], "content");
    if (content !== null) {
      metaDescription = content.trim().slice(0, 500);
      break;
    }
  }

  let indexable = true;
  for (const tag of html.matchAll(META_ROBOTS_NOINDEX_RE)) {
    const content = attrValue(tag[0], "content") ?? "";
    if (/\bnoindex\b/i.test(content)) {
      indexable = false;
      break;
    }
  }

  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const bodyText = stripTagsAndDecode(bodyMatch?.[1] ?? html);

  const anchors: string[] = [];
  for (const tag of html.matchAll(ANCHOR_RE)) {
    const href = tag[1] ?? "";
    const cleaned = href.split("#")[0] ?? "";
    if (!cleaned) continue;
    if (/^(?:mailto:|tel:|javascript:|data:)/i.test(cleaned)) continue;
    anchors.push(cleaned);
  }

  let imagesTotal = 0;
  let imagesWithoutAlt = 0;
  for (const tag of html.matchAll(IMG_RE)) {
    imagesTotal += 1;
    const alt = attrValue(tag[0], "alt");
    if ((alt ?? "").trim() === "") imagesWithoutAlt += 1;
  }

  let hasProductSchema = false;
  for (const match of html.matchAll(SCRIPT_JSONLD_RE)) {
    try {
      const parsed = JSON.parse(match[1] ?? "null") as unknown;
      const types = schemaTypes(parsed);
      if (types.has("Product")) hasProductSchema = true;
    } catch {
      // malformed JSON-LD is not a Product schema; ignore
    }
  }

  return {
    title,
    metaDescription,
    h1Count: [...html.matchAll(H1_RE)].length,
    canonical: LINK_CANONICAL_RE.test(html),
    indexable,
    wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
    imagesTotal,
    imagesWithoutAlt,
    hasProductSchema,
    anchors,
  };
}

function schemaTypes(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) schemaTypes(item, out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["@type"] === "string") out.add(record["@type"] as string);
    if (Array.isArray(record["@type"])) {
      for (const t of record["@type"] as unknown[]) if (typeof t === "string") out.add(t);
    }
    if (record["@graph"]) schemaTypes(record["@graph"], out);
  }
  return out;
}

async function resolveUrl(raw: string, base: URL): Promise<URL | null> {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input as URL, init));
  const sleep = opts.sleepMs ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const base = new URL(opts.baseUrl);
  const baseOrigin = base.origin;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let politenessMs = opts.politenessMs;

  // robots.txt
  let robots: RobotsRules = DEFAULT_ROBOTS;
  const disallowed: string[] = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetchImpl(new URL("/robots.txt", base).toString(), {
      headers: { "user-agent": opts.userAgent },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      robots = parseRobotsTxt(await res.text());
    } else if (res.status !== 404 && res.status !== 410) {
      // Robot errors default to disallow-all per spec for 5xx, but we keep permissive to avoid dead locks.
      politenessMs = Math.max(politenessMs, 1000);
    }
    politenessMs = Math.max(politenessMs, robots.crawlDelayMs ?? 0);
  } catch {
    // unreachable robots.txt => permissive
  }

  const seed = new Set<string>([base.toString(), `${baseOrigin}/`]);
  const exclude = new Set(opts.excludePatterns.map((p) => p.trim()).filter(Boolean));

  // sitemap seed
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetchImpl(`${baseOrigin}/sitemap.xml`, {
      headers: { "user-agent": opts.userAgent },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const xml = await res.text();
      for (const match of xml.matchAll(/<loc>\s*([^<\s]+?)\s*<\/loc>/gi)) {
        const loc = (match[1] ?? "").trim();
        if (!loc) continue;
        const parsed = await resolveUrl(loc, base);
        if (parsed && sameOrigin(parsed, base)) seed.add(parsed.toString());
      }
    }
  } catch {
    // sitemap is optional
  }

  const queue: Array<{ url: string; depth: number }> = [];
  for (const url of seed) queue.push({ url, depth: 0 });

  const visited = new Set<string>();
  const snapshots: PageSnapshot[] = [];
  let linkBudget = opts.linkCheckBudget ?? 0;

  while (queue.length > 0 && snapshots.length < opts.maxUrls) {
    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    visited.add(item.url);

    const url = new URL(item.url);
    if (!isCrawlableUrl(url, base)) continue;
    const pathname = url.pathname;
    if (exclude.size > 0 && [...exclude].some((p) => pathname.includes(p))) continue;
    if (!isPathAllowed(pathname, robots)) {
      disallowed.push(url.toString());
      continue;
    }

    if (snapshots.length > 0) await sleep(politenessMs);

    const started = Date.now();
    let snapshot: PageSnapshot;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetchImpl(url.toString(), {
        headers: { "user-agent": opts.userAgent, accept: "text/html" },
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timer);
      const html = await res.text();
      const parsed = parseHtml(html);
      const loadTimeMs = Date.now() - started;

      // broken-link probe on internal same-origin links, budget-limited
      let broken = 0;
      if (linkBudget > 0) {
        for (const anchor of parsed.anchors) {
          if (linkBudget <= 0) break;
          const target = await resolveUrl(anchor, url);
          if (!target || !sameOrigin(target, base)) continue;
          if (!visited.has(target.toString()) && isCrawlableUrl(target, base)) {
            linkBudget -= 1;
            try {
              const controller2 = new AbortController();
              const timer2 = setTimeout(() => controller2.abort(), Math.min(timeoutMs, 3000));
              const probe = await fetchImpl(target.toString(), {
                method: "HEAD",
                headers: { "user-agent": opts.userAgent },
                signal: controller2.signal,
              });
              clearTimeout(timer2);
              if (probe.status >= 400) broken += 1;
            } catch {
              broken += 1;
            }
            if (linkBudget > 0) await sleep(politenessMs);
          }
        }
      }

      snapshot = {
        url: url.toString(),
        status: res.status,
        title: parsed.title,
        metaDescription: parsed.metaDescription,
        titleLength: parsed.title?.length ?? null,
        metaDescriptionLength: parsed.metaDescription?.length ?? null,
        h1Count: parsed.h1Count,
        hasCanonical: parsed.canonical,
        isIndexable: parsed.indexable,
        wordCount: parsed.wordCount,
        imagesTotal: parsed.imagesTotal,
        imagesWithoutAlt: parsed.imagesWithoutAlt,
        brokenLinks: broken,
        hasProductSchema: parsed.hasProductSchema,
        internalLinks: parsed.anchors,
        loadTimeMs,
        transferBytes: Buffer.byteLength(html),
      };
    } catch {
      snapshot = {
        url: url.toString(),
        status: null,
        title: null,
        metaDescription: null,
        titleLength: null,
        metaDescriptionLength: null,
        h1Count: 0,
        hasCanonical: false,
        isIndexable: true,
        wordCount: 0,
        imagesTotal: 0,
        imagesWithoutAlt: 0,
        brokenLinks: 0,
        hasProductSchema: false,
        internalLinks: [],
        loadTimeMs: Date.now() - started,
        transferBytes: 0,
      };
    }
    snapshots.push(snapshot);

    if (opts.onPage) {
      await opts.onPage(snapshot, snapshots.length, Math.max(snapshots.length, queue.length + snapshots.length));
    }

    if (item.depth < opts.maxDepth) {
      for (const anchor of snapshot.internalLinks) {
        const target = await resolveUrl(anchor, url);
        if (!target || !isCrawlableUrl(target, base)) continue;
        queue.push({ url: target.toString(), depth: item.depth + 1 });
      }
    }
  }

  return { snapshots, robots, disallowed };
}