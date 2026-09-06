import type { ProductAttributes } from "./types.js";

export const MAX_META_TITLE = 60;
export const MAX_META_DESCRIPTION = 160;

function truncate(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  if (max <= 3) return trimmed.slice(0, max);
  let cut = trimmed.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > max * 0.6) cut = cut.slice(0, lastSpace);
  return `${cut.trim()}…`;
}

export interface ValidationResult {
  ok: boolean;
  normalized: string;
  issues: string[];
}

export function normalizeMetaTitle(value: string): ValidationResult {
  const normalized = truncate(value, MAX_META_TITLE);
  return { ok: normalized.length <= MAX_META_TITLE, normalized, issues: [] };
}

export function normalizeMetaDescription(value: string): ValidationResult {
  const normalized = truncate(value, MAX_META_DESCRIPTION);
  return { ok: normalized.length <= MAX_META_DESCRIPTION, normalized, issues: [] };
}

const knownBadPatterns = [
  /FDA[- ]?(approved|cleared)/i,
  /\b100%?\s+natural\b/i,
  /\b(guaranteed|promise|miracle|cure)\b/i,
  /\bproven\s+results\b/i,
];

const claimKeywords = ["contains", "featuring", "with ", "formulated with", "rich in", "packed with"];

function phraseTokens(phrase: string): string[] {
  return phrase.split(/\s+/).filter((t: string) => t.length >= 3 && !["the", "and", "that", "with"].includes(t));
}

export function checkClaimsAgainstAttributes(text: string, attributes: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const allowed = new Set<string>();
  for (const value of Object.values(attributes ?? {})) {
    const parts = Array.isArray(value) ? (value as string[]) : [String(value ?? "")];
    for (const part of parts) {
      for (const token of part.toLowerCase().split(/[^a-z0-9+%]+/).filter((t: string) => t.length >= 3)) {
        allowed.add(token);
      }
    }
  }
  const lower = text.toLowerCase();
  for (const pattern of knownBadPatterns) {
    if (pattern.test(text)) {
      issues.push(`Forbidden claim matches: ${pattern.source}`);
    }
  }
  if (allowed.size > 0) {
    for (const keyword of claimKeywords) {
      let idx = lower.indexOf(keyword);
      while (idx !== -1) {
        const after = (lower.slice(idx + keyword.length).split(/[,.;]+/)[0] ?? "").replace(/^[\s:]+/, "").split(/\s+/).slice(0, 4).join(" ");
        const tokens = phraseTokens(after);
        if (tokens.length && !tokens.some((t: string) => allowed.has(t))) {
          issues.push(`Claim "${keyword}${after ? ` ${after}` : ""}" not in attribute whitelist`);
          break;
        }
        idx = lower.indexOf(keyword, idx + keyword.length);
      }
    }
  }
  return issues;
}

export function validateGeneratedText(
  text: string,
  product: Pick<ProductAttributes, "attributes" | "title">,
  kind: "description" | "blog",
): ValidationResult {
  const issues = checkClaimsAgainstAttributes(text, product.attributes);
  const hasContent = text.trim().length >= 40;
  const normalized = text.trim().replace(/\s+/g, " ").trim();
  if (kind === "description" && normalized.length < 40) {
    issues.push("Generated description too short (< 40 chars)");
  } else if (!hasContent) {
    issues.push("Generated text is empty");
  }
  return { ok: issues.length === 0, normalized, issues };
}