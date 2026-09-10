import { describe, expect, it } from "vitest";
import type { PageSnapshot } from "../audit/crawler.js";
import { computeAuditScore, computeUrlScore, detectIssues } from "../audit/rules.js";

function snapshot(overrides: Partial<PageSnapshot>): PageSnapshot {
  const title = "Glow Co. Clean Beauty Skincare Essentials Store";
  return {
    url: "https://store.example.com/",
    status: 200,
    title,
    metaDescription: "Clean beauty store",
    titleLength: title.length,
    metaDescriptionLength: 19,
    h1Count: 1,
    hasCanonical: true,
    isIndexable: true,
    wordCount: 500,
    imagesTotal: 3,
    imagesWithoutAlt: 0,
    brokenLinks: 0,
    hasProductSchema: true,
    internalLinks: [],
    loadTimeMs: 120,
    transferBytes: 42_000,
    ...overrides,
  };
}

describe("SEO rule engine", () => {
  it("detects nothing on a healthy page", () => {
    const issues = detectIssues(snapshot({}));
    expect(issues).toHaveLength(0);
  });

  it("flags missing title and meta description (metadata)", () => {
    const issues = detectIssues(snapshot({ title: null, titleLength: null, metaDescription: null, metaDescriptionLength: null }));
    expect(issues.map((i) => i.type)).toEqual(expect.arrayContaining(["missing-title", "missing-meta-description"]));
  });

  it("flags over-long title and description", () => {
    const issues = detectIssues(snapshot({ title: "x".repeat(75), titleLength: 75, metaDescription: "y".repeat(200), metaDescriptionLength: 200 }));
    const types = issues.map((i) => i.type);
    expect(types).toContain("meta-title-too-long");
    expect(types).toContain("meta-description-too-long");
  });

  it("flags missing/multiple h1 in content category", () => {
    expect(detectIssues(snapshot({ h1Count: 0 })).map((i) => i.type)).toContain("missing-h1");
    expect(detectIssues(snapshot({ h1Count: 3 })).map((i) => i.type)).toContain("multiple-h1");
  });

  it("flags missing canonical and noindex as indexability issues", () => {
    const types = detectIssues(snapshot({ hasCanonical: false, isIndexable: false })).map((i) => i.type);
    expect(types).toContain("missing-canonical");
    expect(types).toContain("non-indexable");
  });

  it("flags missing schema only on product URLs", () => {
    const issues = detectIssues(snapshot({ url: "https://store.example.com/products/serum", hasProductSchema: false }));
    expect(issues.map((i) => i.type)).toContain("missing-jsonld");
    const homeIssues = detectIssues(snapshot({ url: "https://store.example.com/", hasProductSchema: false }));
    expect(homeIssues.map((i) => i.type)).not.toContain("missing-jsonld");
  });

  it("flags thin content, images without alt, and broken links", () => {
    const issues = detectIssues(snapshot({ wordCount: 20, imagesWithoutAlt: 2, brokenLinks: 1 }));
    const types = issues.map((i) => i.type);
    expect(types).toContain("thin-content");
    expect(types).toContain("images-without-alt");
    expect(types).toContain("broken-links");
  });

  it("flags non-https URLs", () => {
    const issues = detectIssues(snapshot({ url: "http://store.example.com/" }));
    expect(issues.map((i) => i.type)).toContain("non-https");
  });

  it("recommends concrete truncation fixes with fields", () => {
    const issues = detectIssues(snapshot({ title: "q".repeat(70), titleLength: 70, metaDescription: "z".repeat(180), metaDescriptionLength: 180 }));
    const titleFix = issues.find((i) => i.type === "meta-title-too-long")?.recommendedFix;
    const descFix = issues.find((i) => i.type === "meta-description-too-long")?.recommendedFix;
    expect(titleFix?.fields?.metaTitle).toHaveLength(60);
    expect(descFix?.fields?.metaDescription).toHaveLength(160);
  });
});

describe("SEO score computation", () => {
  it("starts at 100 with no issues", () => {
    const urlScore = computeUrlScore(snapshot({}), []);
    expect(urlScore.score).toBe(100);
    expect(urlScore.categories.metadata).toBe(100);
  });

  it("deducts impact scores and clamps at zero", () => {
    const low = computeUrlScore(snapshot({ title: null, titleLength: null }), detectIssues(snapshot({ title: null, titleLength: null })));
    expect(low.score).toBe(75);
  });

  it("weighs product pages higher in aggregate score", () => {
    const product = computeUrlScore(snapshot({ url: "https://store.example.com/products/serum", hasProductSchema: true }), []);
    const home = computeUrlScore(snapshot({ url: "https://store.example.com/" }), []);
    const summary = computeAuditScore([product, home]);
    expect(summary.score).toBe(100);
    expect(summary.urlCount).toBe(2);
    expect(summary.issueCount).toBe(0);
  });

  it("aggregates categories and issue counts", () => {
    const urlScores = [
      computeUrlScore(snapshot({ url: "https://store.example.com/products/a", title: null, titleLength: null }), detectIssues(snapshot({ url: "https://store.example.com/products/a", title: null, titleLength: null }))),
    ];
    const summary = computeAuditScore(urlScores);
    expect(summary.score).toBe(75);
    expect(summary.issueCount).toBe(1);
    expect(summary.categories.metadata).toBe(75);
  });

  it("handles empty crawl", () => {
    const summary = computeAuditScore([]);
    expect(summary.score).toBe(0);
    expect(summary.urlCount).toBe(0);
  });
});