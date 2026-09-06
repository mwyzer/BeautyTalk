import type { ContentProvider, MetaCopy, ProductPromptInput, BlogPromptInput } from "./types.js";
import { buildProductDescriptionPrompt, buildProductMetaPrompt, buildBlogPrompt } from "./prompts.js";
import { normalizeMetaTitle, normalizeMetaDescription, validateGeneratedText } from "./validate.js";
import { ApiError } from "../lib/http.js";
import type { AppConfig } from "../config/env.js";

export interface OpenAiProviderConfig {
  apiKey: string | undefined;
  baseUrl: string;
  modelFast: string;
  modelFull: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

async function complete(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  json?: boolean;
}): Promise<string> {
  const res = await fetch(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    throw ApiError.serviceUnavailable(`Content provider request failed (${res.status})`);
  }
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw ApiError.serviceUnavailable("Content provider returned an empty response");
  return text;
}

function parseMetaJson(text: string): MetaCopy {
  try {
    const parsed = JSON.parse(text) as Partial<MetaCopy>;
    if (typeof parsed.metaTitle === "string" && typeof parsed.metaDescription === "string") {
      return { metaTitle: parsed.metaTitle, metaDescription: parsed.metaDescription };
    }
  } catch {
    // fall through to regex extraction
  }
  const title = text.match(/["']metaTitle["']\s*:\s*["']([^"']+)["']/i)?.[1];
  const description = text.match(/["']metaDescription["']\s*:\s*["']([^"']+)["']/i)?.[1];
  if (title && description) return { metaTitle: title, metaDescription: description };
  throw ApiError.serviceUnavailable("Content provider returned unparsable meta output");
}

export function createOpenAiContentProvider(config: OpenAiProviderConfig): ContentProvider | null {
  const apiKey = config.apiKey;
  if (!apiKey) return null;
  return {
    async generateProductDescription(input: ProductPromptInput): Promise<{ text: string; model: string }> {
      const prompt = buildProductDescriptionPrompt(input);
      const raw = await complete({
        baseUrl: config.baseUrl,
        apiKey,
        model: config.modelFull,
        messages: [{ role: "system", content: "You are a professional e-commerce beauty copywriter." }, { role: "user", content: prompt }],
        maxTokens: 700,
        temperature: 0.7,
      });
      const validated = validateGeneratedText(raw, input.product, "description");
      if (validated.issues.length > 0) throw ApiError.badRequest(`Content validation failed: ${validated.issues[0]}`);
      return { text: validated.normalized, model: config.modelFull };
    },

    async generateProductMeta(input: ProductPromptInput): Promise<{ meta: MetaCopy; model: string }> {
      const prompt = buildProductMetaPrompt(input);
      const raw = await complete({
        baseUrl: config.baseUrl,
        apiKey,
        model: config.modelFast,
        messages: [{ role: "system", content: "You are an SEO specialist. Respond with valid JSON only." }, { role: "user", content: prompt }],
        maxTokens: 220,
        temperature: 0.4,
        json: true,
      });
      const parsed = parseMetaJson(raw);
      const title = normalizeMetaTitle(parsed.metaTitle);
      const description = normalizeMetaDescription(parsed.metaDescription);
      return {
        meta: { metaTitle: title.normalized, metaDescription: description.normalized },
        model: config.modelFast,
      };
    },

    async generateBlog(input: BlogPromptInput): Promise<{ text: string; model: string }> {
      const prompt = buildBlogPrompt(input);
      const raw = await complete({
        baseUrl: config.baseUrl,
        apiKey,
        model: config.modelFull,
        messages: [{ role: "system", content: "You are a beauty content writer." }, { role: "user", content: prompt }],
        maxTokens: 1200,
        temperature: 0.7,
      });
      const validated = validateGeneratedText(raw, input.products[0] ?? { attributes: {}, title: "" }, "blog");
      return { text: validated.normalized, model: config.modelFull };
    },
  };
}

export function createContentProvider(config: AppConfig): ContentProvider | null {
  return createOpenAiContentProvider({
    apiKey: config.OPENAI_API_KEY,
    baseUrl: config.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    modelFast: config.OPENAI_MODEL_FAST,
    modelFull: config.OPENAI_MODEL_FULL,
  });
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function createStubContentProvider(): ContentProvider {
  return {
    async generateProductDescription(input: ProductPromptInput): Promise<{ text: string; model: string }> {
      const attr = Object.values(input.product.attributes ?? {}).filter((v) => typeof v === "string" || Array.isArray(v));
      const detail = attr.length
        ? cleanText(Array.isArray(attr[0]) ? (Array.isArray(attr[0]) ? attr[0].join(", ") : String(attr[0])) : String(attr[0]))
        : cleanText(input.product.productType ?? input.product.title);
      const text = cleanText(
        `${input.product.title} is a ${input.product.productType ?? "beauty"} crafted for effortless daily routines. Formulated ${detail.slice(0, 140)}, it pairs well with the rest of your ritual and keeps results simple, honest, and visible.`,
      );
      return { text, model: "stub" };
    },

    async generateProductMeta(input: ProductPromptInput): Promise<{ meta: MetaCopy; model: string }> {
      const description = normalizeMetaDescription(
        cleanText(`Shop ${input.product.title} — ${input.product.productType ?? "clean beauty"} made for your daily ritual.`),
      );
      const title = normalizeMetaTitle(cleanText(`${input.product.title} | BeautyTalk`));
      return { meta: { metaTitle: title.normalized, metaDescription: description.normalized }, model: "stub" };
    },

    async generateBlog(input: BlogPromptInput): Promise<{ text: string; model: string }> {
      const names = input.products.slice(0, 2).map((p) => p.title);
      const text = cleanText(
        `${input.topic} doesn't have to be complicated. With ${names.length ? names.join(" and ") : "a few fundamentals"}, a calm, effective routine is closer than you think. Start with the basics, listen to your skin, and let consistency do the heavy lifting.`,
      );
      return { text, model: "stub" };
    },
  };
}