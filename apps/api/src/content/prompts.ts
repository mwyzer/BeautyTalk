import type { BlogPromptInput, ProductPromptInput, ToneInput } from "./types.js";

const MAX_QUOTE = 200;

function summarizeAttributes(p: ProductPromptInput["product"]): string {
  const lines: string[] = [];
  lines.push(`Title: ${p.title}`);
  if (p.productType) lines.push(`Product type: ${p.productType}`);
  if (p.vendor) lines.push(`Brand/vendor: ${p.vendor}`);
  if (p.tags.length) lines.push(`Tags: ${p.tags.join(", ")}`);
  for (const [key, value] of Object.entries(p.attributes ?? {})) {
    if (value == null || value === "") continue;
    const formatted = Array.isArray(value) ? value.join(", ") : String(value);
    lines.push(`${key}: ${formatted}`);
  }
  return lines.length ? lines.join("\n") : "(no structured attributes provided)";
}

function toneRules(tone: ToneInput): string {
  const rules: string[] = [];
  if (tone.voice) rules.push(`Brand voice: ${tone.voice}`);
  if (tone.language && tone.language !== "en") rules.push(`Write in language: ${tone.language}`);
  if (tone.forbiddenWords.length) rules.push(`Never use these words: ${tone.forbiddenWords.join(", ")}`);
  if (Object.keys(tone.preferredTerms ?? {}).length) {
    const terms = Object.entries(tone.preferredTerms)
      .map(([a, b]) => `use "${b}" instead of "${a}"`)
      .join("; ");
    rules.push(`Terminology: ${terms}.`);
  }
  if (tone.samplePhrases.length) {
    const samples = tone.samplePhrases.map((s) => s.slice(0, MAX_QUOTE));
    rules.push(`Match this style:\n${samples.map((s) => `- ${s}`).join("\n")}`);
  }
  return rules.length ? rules.join("\n") : "(no tone overrides, write natural, confident, clean-beauty copy)";
}

const SEO_GROUND_RULES = `
SEO rules:
- Only claim facts explicitly present in the product attributes above. Never invent ingredients, benefits, sizes, or certifications.
- Mention one or two real attributes as hero claims when available.
- Keep the tone human, specific, and free of marketing overpromise.`;

export function buildProductDescriptionPrompt(input: ProductPromptInput): string {
  return `
You are a beauty copywriter for an e-commerce storefront. Write a product description in plain text (paragraphs, no headings, no lists) approximately 60-100 words.

${toneRules(input.tone)}

Product attributes (the ONLY source of truth):
${summarizeAttributes(input.product)}

${SEO_GROUND_RULES}`.trim();
}

export function buildProductMetaPrompt(input: ProductPromptInput): string {
  return `
You are an SEO content specialist for an e-commerce storefront. Generate product meta tags based strictly on the attributes below.

${toneRules(input.tone)}

Product attributes (the ONLY source of truth):
${summarizeAttributes(input.product)}

Rules:
- metaTitle: 60 characters max, natural, leading keyword first when obvious.
- metaDescription: 160 characters max, one sentence that includes one real attribute.
- Only use facts present in the attributes.
- Respond with valid JSON only: {"metaTitle": "...", "metaDescription": "..."}`.trim();
}

export function buildBlogPrompt(input: BlogPromptInput): string {
  const facts = input.products.map((p: ProductPromptInput["product"], i: number) => `Product ${i + 1}:\n${summarizeAttributes(p)}`).join("\n\n");
  return `
You are a beauty content writer. Write a short blog post (250-350 words) about: ${input.topic}

${toneRules(input.tone)}

Products that must be mentioned only with verified facts:
${facts}

Rules: plain text with short paragraphs. No fabricated attributes, no medical claims, no prices. Never mention a product attribute that is not in the lists above.`.trim();
}

export function splitMetaOutput(metaTitle: string, metaDescription: string): { metaTitle: string; metaDescription: string } {
  return {
    metaTitle: (metaTitle ?? "").trim(),
    metaDescription: (metaDescription ?? "").trim(),
  };
}