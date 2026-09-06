export interface ToneInput {
  voice: string | null;
  forbiddenWords: string[];
  preferredTerms: Record<string, string>;
  samplePhrases: string[];
  language: string;
}

export interface ProductAttributes {
  title: string;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  attributes: Record<string, unknown>;
  existingDescription: string | null;
  existingBodyHtml: string | null;
}

export interface ProductPromptInput {
  product: ProductAttributes;
  tone: ToneInput;
}

export interface BlogPromptInput {
  topic: string;
  products: ProductAttributes[];
  tone: ToneInput;
}

export interface MetaCopy {
  metaTitle: string;
  metaDescription: string;
}

export interface ContentProvider {
  generateProductDescription(input: ProductPromptInput): Promise<{ text: string; model: string }>;
  generateProductMeta(input: ProductPromptInput): Promise<{ meta: MetaCopy; model: string }>;
  generateBlog(input: BlogPromptInput): Promise<{ text: string; model: string }>;
}