import type { IssueCategory, IssueSeverity, IssueType, RecommendedFix } from "@beautyai/shared";
import { ISSUE_CATEGORIES } from "@beautyai/shared";
import type { PageSnapshot } from "./crawler.js";

export interface DetectedIssue {
  type: IssueType;
  severity: IssueSeverity;
  category: IssueCategory;
  impactScore: number;
  recommendedFix: RecommendedFix | null;
}

export interface UrlScore {
  url: string;
  score: number;
  categories: Record<IssueCategory, number>;
  issues: DetectedIssue[];
}

export interface AuditScoreSummary {
  score: number;
  categories: Record<IssueCategory, number>;
  urlCount: number;
  issueCount: number;
}

export const MAX_TITLE_LENGTH = 60;
export const MIN_TITLE_LENGTH = 20;
export const MAX_DESCRIPTION_LENGTH = 160;
export const THIN_CONTENT_WORDS = 100;

const CATEGORY_BY_TYPE: Partial<Record<IssueType, IssueCategory>> = {
  "missing-title": "metadata",
  "meta-title-too-long": "metadata",
  "meta-title-too-short": "metadata",
  "missing-meta-description": "metadata",
  "meta-description-too-long": "metadata",
  "missing-h1": "content",
  "multiple-h1": "content",
  "thin-content": "content",
  "images-without-alt": "content",
  "broken-links": "links",
  "missing-jsonld": "schema",
  "missing-canonical": "indexability",
  "non-indexable": "indexability",
  "non-https": "indexability",
};

export function categoryForType(type: IssueType): IssueCategory {
  return CATEGORY_BY_TYPE[type] ?? "content";
}

interface Rule {
  type: IssueType;
  category: IssueCategory;
  severity: IssueSeverity;
  impact: number;
  check: (s: PageSnapshot) => boolean;
  label: (s: PageSnapshot) => string;
  fix: (s: PageSnapshot) => RecommendedFix | null;
}

const RULES: Rule[] = [
  {
    type: "missing-title",
    category: "metadata",
    severity: "high",
    impact: 25,
    check: (s) => !s.title,
    label: () => "Page has no <title> tag",
    fix: (s) => ({ action: "generate_meta", label: "Generate a title from page content" }),
  },
  {
    type: "meta-title-too-long",
    category: "metadata",
    severity: "medium",
    impact: 10,
    check: (s) => Boolean(s.title && (s.titleLength ?? 0) > MAX_TITLE_LENGTH),
    label: (s) => `Title is ${s.titleLength} chars (max ${MAX_TITLE_LENGTH})`,
    fix: (s) => ({
      action: "set_meta_title",
      label: `Truncate title to ${MAX_TITLE_LENGTH} characters`,
      fields: { metaTitle: (s.title ?? "").slice(0, MAX_TITLE_LENGTH).trim() },
    }),
  },
  {
    type: "meta-title-too-short",
    category: "metadata",
    severity: "low",
    impact: 5,
    check: (s) => Boolean(s.title && (s.titleLength ?? 0) > 0 && (s.titleLength ?? 0) < MIN_TITLE_LENGTH),
    label: (s) => `Title is too short (${s.titleLength} chars, min ${MIN_TITLE_LENGTH})`,
    fix: () => ({ action: "generate_meta", label: "Expand title to be more descriptive" }),
  },
  {
    type: "missing-meta-description",
    category: "metadata",
    severity: "medium",
    impact: 15,
    check: (s) => !s.metaDescription,
    label: () => "Page has no meta description",
    fix: () => ({ action: "generate_meta", label: "Add a meta description from page content" }),
  },
  {
    type: "meta-description-too-long",
    category: "metadata",
    severity: "low",
    impact: 5,
    check: (s) => Boolean(s.metaDescription && (s.metaDescriptionLength ?? 0) > MAX_DESCRIPTION_LENGTH),
    label: (s) => `Meta description is ${s.metaDescriptionLength} chars (max ${MAX_DESCRIPTION_LENGTH})`,
    fix: (s) => ({
      action: "set_meta_description",
      label: `Truncate meta description to ${MAX_DESCRIPTION_LENGTH} characters`,
      fields: { metaDescription: (s.metaDescription ?? "").slice(0, MAX_DESCRIPTION_LENGTH).trim() },
    }),
  },
  {
    type: "missing-h1",
    category: "content",
    severity: "high",
    impact: 20,
    check: (s) => s.h1Count === 0,
    label: () => "Page has no <h1> heading",
    fix: () => ({ action: "generate_h1", label: "Add a single descriptive <h1>" }),
  },
  {
    type: "multiple-h1",
    category: "content",
    severity: "low",
    impact: 5,
    check: (s) => s.h1Count > 1,
    label: (s) => `Page has ${s.h1Count} <h1> headings (expected 1)`,
    fix: () => ({ action: "fix_h1", label: "Keep a single <h1> per page" }),
  },
  {
    type: "missing-canonical",
    category: "indexability",
    severity: "medium",
    impact: 10,
    check: (s) => !s.hasCanonical,
    label: () => "Page has no canonical URL",
    fix: () => ({ action: "add_canonical", label: "Add a self-referencing canonical link" }),
  },
  {
    type: "non-indexable",
    category: "indexability",
    severity: "low",
    impact: 5,
    check: (s) => !s.isIndexable,
    label: () => "Page is flagged noindex for search engines",
    fix: () => ({ action: "allow_index", label: "Remove the noindex robots directive if the page should rank" }),
  },
  {
    type: "missing-jsonld",
    category: "schema",
    severity: "medium",
    impact: 10,
    check: (s) => /\/products\/[a-z0-9-]+/i.test(s.url) && !s.hasProductSchema,
    label: () => "Product page has no Product JSON-LD schema",
    fix: () => ({ action: "add_schema", label: "Add Product schema.org markup" }),
  },
  {
    type: "thin-content",
    category: "content",
    severity: "medium",
    impact: 15,
    check: (s) => s.wordCount > 0 && s.wordCount < THIN_CONTENT_WORDS,
    label: (s) => `Thin content: only ${s.wordCount} words`,
    fix: () => ({ action: "generate_description", label: "Expand the page with a richer product description" }),
  },
  {
    type: "images-without-alt",
    category: "content",
    severity: "medium",
    impact: 10,
    check: (s) => s.imagesTotal > 0 && s.imagesWithoutAlt > 0,
    label: (s) => `${s.imagesWithoutAlt} of ${s.imagesTotal} images missing alt text`,
    fix: () => ({ action: "set_image_alt", label: "Set descriptive alt text on product images" }),
  },
  {
    type: "broken-links",
    category: "links",
    severity: "high",
    impact: 20,
    check: (s) => s.brokenLinks > 0,
    label: (s) => `${s.brokenLinks} broken internal link${s.brokenLinks > 1 ? "s" : ""}`,
    fix: () => ({ action: "fix_broken_links", label: "Fix or remove broken internal links" }),
  },
  {
    type: "non-https",
    category: "indexability",
    severity: "high",
    impact: 25,
    check: (s) => !s.url.startsWith("https://"),
    label: () => "Page served over insecure HTTP",
    fix: () => ({ action: "enable_https", label: "Serve the storefront over HTTPS" }),
  },
];

export function detectIssues(snapshot: PageSnapshot): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  for (const rule of RULES) {
    if (!rule.check(snapshot)) continue;
    issues.push({
      type: rule.type,
      severity: rule.severity,
      category: rule.category,
      impactScore: rule.impact,
      recommendedFix: rule.fix(snapshot),
    });
  }
  return issues;
}

export function computeUrlScore(snapshot: PageSnapshot, issues: DetectedIssue[]): UrlScore {
  const categories = Object.fromEntries(ISSUE_CATEGORIES.map((c) => [c, 100])) as Record<IssueCategory, number>;
  let deductedTotal = 0;
  for (const issue of issues) {
    categories[issue.category] = Math.max(0, (categories[issue.category] ?? 100) - issue.impactScore);
    deductedTotal += issue.impactScore;
  }
  return {
    url: snapshot.url,
    score: Math.max(0, 100 - deductedTotal),
    categories,
    issues,
  };
}

export function computeAuditScore(urlScores: UrlScore[]): AuditScoreSummary {
  if (urlScores.length === 0) {
    return {
      score: 0,
      categories: Object.fromEntries(ISSUE_CATEGORIES.map((c) => [c, 0])) as Record<IssueCategory, number>,
      urlCount: 0,
      issueCount: 0,
    };
  }
  const categories = Object.fromEntries(ISSUE_CATEGORIES.map((c) => [c, 0])) as Record<IssueCategory, number>;
  let scoreSum = 0;
  let issueCount = 0;
  let weightSum = 0;
  for (const urlScore of urlScores) {
    const weight = /\/products\/[a-z0-9-]+/i.test(urlScore.url) ? 2 : 1;
    scoreSum += urlScore.score * weight;
    weightSum += weight;
    for (const category of ISSUE_CATEGORIES) {
      categories[category] = (categories[category] ?? 0) + (urlScore.categories[category] ?? 0);
    }
    issueCount += urlScore.issues.length;
  }
  for (const category of ISSUE_CATEGORIES) {
    categories[category] = Math.round((categories[category] ?? 0) / urlScores.length);
  }
  return {
    score: Math.round(scoreSum / weightSum),
    categories,
    urlCount: urlScores.length,
    issueCount,
  };
}