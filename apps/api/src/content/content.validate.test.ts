import { describe, expect, it } from "vitest";
import {
  checkClaimsAgainstAttributes,
  MAX_META_DESCRIPTION,
  MAX_META_TITLE,
  normalizeMetaDescription,
  normalizeMetaTitle,
  validateGeneratedText,
} from "./validate.js";
import { buildProductDescriptionPrompt, buildProductMetaPrompt, splitMetaOutput } from "./prompts.js";
import { createStubContentProvider, createOpenAiContentProvider } from "./provider.js";

describe("content validation", () => {
  it("truncates meta title to 60 chars with an ellipsis", () => {
    const long = "x".repeat(120);
    const result = normalizeMetaTitle(long);
    expect(result.ok).toBe(true);
    expect(result.normalized.length).toBeLessThanOrEqual(MAX_META_TITLE);
    expect(result.normalized.endsWith("…")).toBe(true);
  });

  it("normalizes whitespace while staying under meta limits", () => {
    const dirty = "  Mega    Serum   —   Fresh   Glow  ";
    expect(normalizeMetaDescription(dirty).normalized).toBe("Mega Serum — Fresh Glow");
    expect(normalizeMetaDescription(dirty).normalized.length).toBeLessThanOrEqual(MAX_META_DESCRIPTION);
  });

  it("flags forbidden claim patterns", () => {
    expect(checkClaimsAgainstAttributes("The secret is FDA-approved for all.", {})).toHaveLength(1);
    expect(checkClaimsAgainstAttributes("It's 100% natural plant oil.", { ingredient: ["plant oil"] })).toHaveLength(1);
    expect(checkClaimsAgainstAttributes("Guaranteed clear skin.", {})).toHaveLength(1);
    expect(checkClaimsAgainstAttributes("Proven results in 7 days.", {})).toHaveLength(1);
  });

  it("allows claims only when the ingredient is in the attribute whitelist", () => {
    const attrs = { "key_ingredient": ["hyaluronic acid"], "skin_type": "all" };
    expect(checkClaimsAgainstAttributes("Formulated with hyaluronic acid for all skin types.", attrs)).toHaveLength(0);
    expect(checkClaimsAgainstAttributes("Formulated with retinol for glow.", attrs)).not.toHaveLength(0);
  });

  it("requires 40+ chars for a description", () => {
    const short = validateGeneratedText("Nice serum.", { title: "Serum", attributes: {} }, "description");
    expect(short.ok).toBe(false);
    expect(short.issues.some((i) => i.includes("too short"))).toBe(true);

    const long = validateGeneratedText(
      "A lightweight hydrating serum with hyaluronic acid that plumps and refreshes the skin every day.",
      { title: "Serum", attributes: { "key_ingredient": ["hyaluronic acid"] } },
      "description",
    );
    expect(long.ok).toBe(true);
  });
});

describe("prompt builder", () => {
  const product = {
    id: "p1",
    title: "Glow Serum",
    handle: "glow-serum",
    productType: "serum",
    vendor: null,
    attributes: { "key_ingredient": ["hyaluronic acid"] },
    tags: ["serum", "hydrating"],
    existingDescription: null,
    existingBodyHtml: null,
  };
  const tone = { voice: "warm", forbiddenWords: ["miracle"], preferredTerms: {} as Record<string, string>, samplePhrases: [] as string[], language: "en" };

  it("includes product facts and tone without PII", () => {
    const prompt = buildProductDescriptionPrompt({ product, tone });
    expect(prompt).toContain("Glow Serum");
    expect(prompt).toContain("hyaluronic acid");
    expect(prompt).toContain("warm");
    expect(prompt).toContain("miracle");
  });

  it("builds meta prompt and splits output on delimiter", () => {
    const prompt = buildProductMetaPrompt({ product, tone });
    expect(prompt).toContain("Glow Serum");
    const split = splitMetaOutput("Glow Serum | A hydrating daily serum", "Glow Serum - A light hydrating serum for daily skin plump.");
    expect(split.metaTitle).toBe("Glow Serum | A hydrating daily serum");
    expect(split.metaDescription).toBe("Glow Serum - A light hydrating serum for daily skin plump.");
  });

  it("stub provider outputs pass length limits", async () => {
    const provider = createStubContentProvider();
    const desc = await provider.generateProductDescription({ product, tone });
    expect(desc.text.length).toBeGreaterThanOrEqual(40);
    const meta = await provider.generateProductMeta({ product, tone });
    expect(meta.meta.metaTitle.length).toBeLessThanOrEqual(MAX_META_TITLE);
    expect(meta.meta.metaDescription.length).toBeLessThanOrEqual(MAX_META_DESCRIPTION);
    const blog = await provider.generateBlog({ topic: "Daily skin care", products: [product], tone });
    expect(blog.text.length).toBeGreaterThan(0);
  });
});

describe("openai provider wiring", () => {
  it("returns null client when key is missing", () => {
    const provider = createOpenAiContentProvider({ apiKey: undefined, baseUrl: "https://api.openai.com/v1", modelFast: "gpt-4o-mini", modelFull: "gpt-4o" });
    expect(provider).toBeNull();
  });

  it("returns a configured client when key present", () => {
    const provider = createOpenAiContentProvider({ apiKey: "sk-test-123", baseUrl: "https://api.openai.com/v1", modelFast: "gpt-4o-mini", modelFull: "gpt-4o" });
    expect(provider).not.toBeNull();
  });
});
