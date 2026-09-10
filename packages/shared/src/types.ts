export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const TENANT_STATUSES = ["active", "suspended", "trialing"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export interface User {
  id: string;
  email: string;
  fullName: string | null;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  customDomain: string | null;
  currency: string;
  locale: string;
  status: TenantStatus;
  createdAt: string;
}

export interface Membership {
  tenantId: string;
  role: Role;
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  tokens: AuthTokens;
  user: User;
  tenant: Tenant;
}

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const ORDER_STATUSES = ["pending", "paid", "fulfilled", "shipped", "delivered", "cancelled", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const CART_STATUSES = ["active", "abandoned", "converted"] as const;
export type CartStatus = (typeof CART_STATUSES)[number];

export interface ProductVariant {
  id: string;
  productId: string;
  title: string;
  sku: string;
  barcode: string | null;
  priceAmount: number;
  compareAtPrice: number | null;
  weightG: number | null;
  optionValues: Record<string, string>;
  position: number;
  isDefault: boolean;
  inventoryQty: number;
}

export interface ProductSeo {
  metaTitle: string | null;
  metaDescription: string | null;
  keywords: string[];
  ogTitle: string | null;
  ogDescription: string | null;
  canonicalUrl: string | null;
}

export interface ProductImage {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

export interface Product {
  id: string;
  tenantId: string;
  title: string;
  handle: string;
  description: string | null;
  bodyHtml: string | null;
  status: ProductStatus;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  attributes: Record<string, unknown>;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  variants: ProductVariant[];
  images: ProductImage[];
  seo: ProductSeo | null;
  collectionIds: string[];
}

export interface CollectionSummary {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  imageUrl: string | null;
  productCount: number;
}

export interface CollectionDetail extends CollectionSummary {
  sortOrder: string;
  published: boolean;
  rule: Record<string, unknown> | null;
  products: Product[];
}

export interface CartItemPayload {
  id: string;
  variantId: string;
  quantity: number;
  unitPriceAmount: number;
  productId: string;
  productTitle: string;
  productHandle: string;
  variantTitle: string;
  sku: string;
  imageUrl: string | null;
  inventoryQty: number;
  lineTotalAmount: number;
}

export interface Cart {
  id: string;
  tenantId: string;
  customerId: string | null;
  discountCode: string | null;
  subtotalAmount: number;
  itemCount: number;
  items: CartItemPayload[];
}

export interface OrderCustomer {
  id: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface OrderItem {
  id: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  unitPriceAmount: number;
  quantity: number;
  lineTotalAmount: number;
}

export interface OrderEvent {
  id: string;
  type: string;
  actorId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface OrderShipment {
  id: string;
  carrier: string | null;
  trackingNumber: string | null;
  status: string;
  shippedAt: string | null;
  address: Record<string, unknown> | null;
}

export interface Order {
  id: string;
  tenantId: string;
  number: number;
  status: OrderStatus;
  email: string | null;
  subtotalAmount: number;
  discountAmount: number;
  shippingAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  stripeSessionId: string | null;
  notes: string | null;
  placedAt: string;
  createdAt: string;
  updatedAt: string;
  customer: OrderCustomer;
  items: OrderItem[];
  events: OrderEvent[];
  shipments: OrderShipment[];
}

export interface CustomerAddress {
  id: string;
  label: string | null;
  firstName: string | null;
  lastName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
  isDefault: boolean;
}

export interface Customer {
  id: string;
  tenantId: string;
  userId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  tags: string[];
  notes: string | null;
  totalSpentAmount: number;
  ordersCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerAuthResponse {
  accessToken: string;
  expiresIn: number;
  customer: Customer;
}

export interface CheckoutInfo {
  checkoutUrlAvailable: boolean;
  sessionId: string;
  sessionUrl: string | null;
  expiresAt: string | null;
  paymentStatus: string | null;
}

export interface CheckoutResult {
  sessionId: string;
  sessionUrl: string | null;
  cartId: string;
  orderNumber: number | null;
}

// ===== Content (Phase 2: AI Content Engine) =====

export const CONTENT_TYPES = ["product_description", "meta", "blog"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const DRAFT_STATUSES = ["draft", "approved", "published", "rejected"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export interface BrandTone {
  id: string;
  tenantId: string;
  name: string | null;
  voice: string | null;
  forbiddenWords: string[];
  preferredTerms: Record<string, string>;
  samplePhrases: string[];
  language: string;
  updatedAt: string;
}

export interface ContentDraft {
  id: string;
  tenantId: string;
  type: ContentType;
  targetType: string | null;
  targetId: string | null;
  title: string | null;
  body: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  status: DraftStatus;
  llmModel: string | null;
  promptSnapshot: Record<string, unknown> | null;
  createdBy: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentVersion {
  id: string;
  draftId: string;
  version: number;
  body: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  changeSummary: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CreditLedgerEntry {
  id: string;
  tenantId: string;
  userId: string | null;
  operation: string;
  amount: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface FeatureQuota {
  tenantId: string;
  feature: string;
  used: number;
  quotaLimit: number;
  periodStart: string;
}

// ===== SEO Audit (Phase 3: SEO Auditor) =====

export const AUDIT_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const ISSUE_STATUSES = ["open", "fixed", "dismissed"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_SEVERITIES = ["high", "medium", "low"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const ISSUE_TYPES = [
  "missing-title",
  "meta-title-too-long",
  "meta-title-too-short",
  "missing-meta-description",
  "meta-description-too-long",
  "missing-h1",
  "multiple-h1",
  "missing-canonical",
  "non-indexable",
  "missing-jsonld",
  "thin-content",
  "images-without-alt",
  "broken-links",
  "non-https",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_CATEGORIES = ["metadata", "content", "links", "schema", "indexability"] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export interface Audit {
  id: string;
  tenantId: string;
  name: string | null;
  status: AuditStatus;
  crawlDepth: number;
  excludePatterns: string[];
  totalUrls: number;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CrawlUrl {
  id: string;
  auditId: string;
  url: string;
  status: number | null;
  title: string | null;
  metaDescription: string | null;
  metaTitleLength: number | null;
  metaDescriptionLength: number | null;
  hasH1: boolean | null;
  hasCanonical: boolean | null;
  isIndexable: boolean | null;
  wordCount: number | null;
  imagesWithoutAlt: number | null;
  brokenLinks: number | null;
  lighthouseScore: Record<string, unknown> | null;
  crawledAt: string;
}

export interface RecommendedFix {
  action: string;
  label: string;
  fields?: Record<string, unknown>;
}

export interface AuditIssue {
  id: string;
  tenantId: string;
  auditId: string;
  type: IssueType;
  url: string | null;
  severity: IssueSeverity;
  impactScore: number;
  status: IssueStatus;
  recommendedFix: RecommendedFix | null;
  fixedAt: string | null;
  createdAt: string;
}

export interface SeoScore {
  id: string;
  tenantId: string;
  auditId: string | null;
  score: number;
  categories: Record<IssueCategory, number>;
  createdAt: string;
}

export interface IssueFix {
  id: string;
  tenantId: string;
  issueId: string;
  type: IssueType;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  result: string | null;
  createdAt: string;
}

// ===== Marketing Analytics (Phase 4) =====

export const ANALYTICS_PROVIDERS = ["gsc", "ga4", "ads"] as const;
export type AnalyticsProvider = (typeof ANALYTICS_PROVIDERS)[number];

export const SYNC_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export interface AnalyticsConnection {
  id: string;
  tenantId: string;
  provider: AnalyticsProvider;
  accountId: string | null;
  status: string;
  lastSyncAt: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsSync {
  id: string;
  tenantId: string;
  provider: AnalyticsProvider;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string | null;
  recordsProcessed: number;
  error: string | null;
}

export interface GscRow {
  id: string;
  date: string;
  query: string | null;
  page: string | null;
  country: string | null;
  device: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Ga4Row {
  id: string;
  date: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  landingPage: string | null;
  sessions: number;
  users: number;
  newUsers: number;
  engagementRate: number;
  conversions: number;
  revenueAmount: number;
}

export interface AdsRow {
  id: string;
  date: string;
  campaignId: string | null;
  campaignName: string | null;
  adGroup: string | null;
  keyword: string | null;
  clicks: number;
  impressions: number;
  costMicros: number;
  conversions: number;
  conversionValueMicros: number;
}

export interface GscReportRow {
  query: string | null;
  page: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Ga4TrafficRow {
  source: string | null;
  medium: string | null;
  sessions: number;
  users: number;
  conversionRate: number;
  revenueAmount: number;
}

export interface AdsCampaignRow {
  campaignName: string | null;
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
  conversionValue: number;
  roas: number;
}

export interface AnalyticsOverviewKpis {
  organicClicks: number;
  organicImpressions: number;
  organicCtr: number;
  organicPosition: number;
  sessions: number;
  users: number;
  conversions: number;
  adClicks: number;
  adSpend: number;
  adRevenue: number;
  roas: number;
}

export interface AnalyticsOverviewPoint {
  date: string;
  clicks: number;
  impressions: number;
  sessions: number;
  adClicks: number;
  adCost: number;
  adRevenue: number;
}

export interface AnalyticsOverview {
  startDate: string;
  endDate: string;
  kpis: AnalyticsOverviewKpis;
  series: AnalyticsOverviewPoint[];
}