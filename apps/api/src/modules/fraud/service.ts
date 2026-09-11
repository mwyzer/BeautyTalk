import type { DbPool } from "@beautyai/db";
import type {
  FraudConfig,
  FraudFlagDetails,
  FraudFlagListItem,
  FraudFlagStatus,
  FraudOverview,
  FraudRule,
  FraudScanResult,
} from "@beautyai/shared";
import { ApiError } from "../../lib/http.js";
import {
  distinctCustomerAddressCounts,
  findFraudFlagById,
  fraudOverview,
  getFraudConfigRaw,
  insertFraudFlags,
  listCandidateOrders,
  listFraudFlags,
  setFraudFlagStatus,
  upsertFraudConfig,
  type CandidateOrderRow,
  type FraudFlagRow,
  type InsertFlagInput,
} from "./fraud.repo.js";

export interface FraudServiceDeps {
  db: DbPool;
}

export function defaultFraudConfig(): FraudConfig {
  return {
    minRiskScore: 40,
    lookbackDays: 90,
    velocity: { enabled: true, weight: 60, orders: 3, withinHours: 3 },
    refundAbuse: { enabled: true, weight: 50, refundRatio: 0.5, minOrders: 2 },
    addressMismatch: { enabled: true, weight: 40 },
    newAccountBurst: { enabled: true, weight: 60, orders: 3, withinHours: 24, accountAgeDays: 7 },
  };
}

function mergeConfig(stored: FraudConfig | null, patch?: Partial<FraudConfig>): FraudConfig {
  const merged = defaultFraudConfig();
  const s = stored ?? defaultFraudConfig();
  merged.minRiskScore = patch?.minRiskScore ?? s.minRiskScore;
  merged.lookbackDays = patch?.lookbackDays ?? s.lookbackDays;
  merged.velocity = { ...merged.velocity, ...s.velocity, ...patch?.velocity };
  merged.refundAbuse = { ...merged.refundAbuse, ...s.refundAbuse, ...patch?.refundAbuse };
  merged.addressMismatch = { ...merged.addressMismatch, ...s.addressMismatch, ...patch?.addressMismatch };
  merged.newAccountBurst = { ...merged.newAccountBurst, ...s.newAccountBurst, ...patch?.newAccountBurst };
  return merged;
}

interface Aggregated {
  totals: Map<string, number>;
  refunded: Map<string, number>;
  created: Map<string, Date>;
  distinctAddresses: Map<string, number>;
}

function aggregate(rows: CandidateOrderRow[], distinctAddresses: Map<string, number>): Aggregated {
  const totals = new Map<string, number>();
  const refunded = new Map<string, number>();
  const created = new Map<string, Date>();
  for (const r of rows) {
    totals.set(r.customer_id, (totals.get(r.customer_id) ?? 0) + 1);
    if (r.status === "refunded") refunded.set(r.customer_id, (refunded.get(r.customer_id) ?? 0) + 1);
    const existing = created.get(r.customer_id);
    if (!existing || r.customer_created_at < existing) created.set(r.customer_id, r.customer_created_at);
  }
  return { totals, refunded, created, distinctAddresses };
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000;
}

function withinWindow(placed: Date, ref: Date, windowHours: number): boolean {
  return Math.abs(placed.getTime() - ref.getTime()) <= windowHours * 3_600_000;
}

function evaluateOrder(
  order: CandidateOrderRow,
  allOrders: CandidateOrderRow[],
  agg: Aggregated,
  config: FraudConfig,
): { rules: FraudRule[]; riskScore: number; details: FraudFlagDetails } {
  const rules: FraudRule[] = [];
  const details: FraudFlagDetails = {};
  let riskScore = 0;

  // Velocity: N+ orders from the same customer within a short window.
  if (config.velocity.enabled) {
    const inWindow = allOrders.filter(
      (o) => o.customer_id === order.customer_id && withinWindow(o.placed_at, order.placed_at, config.velocity.withinHours),
    ).length;
    if (inWindow >= config.velocity.orders) {
      rules.push("velocity");
      riskScore += config.velocity.weight;
      details.velocity = { count: inWindow, windowHours: config.velocity.withinHours };
    }
  }

  // Refund abuse: customer refunds a large share of orders.
  if (config.refundAbuse.enabled && !["refunded", "cancelled"].includes(order.status)) {
    const total = agg.totals.get(order.customer_id) ?? 0;
    const refunded = agg.refunded.get(order.customer_id) ?? 0;
    const ratio = total > 0 ? refunded / total : 0;
    if (total >= config.refundAbuse.minOrders && ratio >= config.refundAbuse.refundRatio) {
      rules.push("refund_abuse");
      riskScore += config.refundAbuse.weight;
      details.refundAbuse = { refunded, total, ratio: Math.round(ratio * 100) / 100 };
    }
  }

  // Address mismatch: customer has multiple distinct billing/shipping addresses.
  if (config.addressMismatch.enabled) {
    const distinct = agg.distinctAddresses.get(order.customer_id) ?? 0;
    if (distinct >= 2) {
      rules.push("address_mismatch");
      riskScore += config.addressMismatch.weight;
      details.addressMismatch = { distinctAddresses: distinct };
    }
  }

  // New-account burst: recently created account placing many orders in a short window.
  if (config.newAccountBurst.enabled) {
    const ageHours = (order.placed_at.getTime() - (agg.created.get(order.customer_id)?.getTime() ?? order.placed_at.getTime())) / 3_600_000;
    const accountFresh = ageHours >= 0 && ageHours <= config.newAccountBurst.accountAgeDays * 24;
    if (accountFresh) {
      const inWindow = allOrders.filter(
        (o) => o.customer_id === order.customer_id && withinWindow(o.placed_at, order.placed_at, config.newAccountBurst.withinHours),
      ).length;
      if (inWindow >= config.newAccountBurst.orders) {
        rules.push("new_account_burst");
        riskScore += config.newAccountBurst.weight;
        details.newAccountBurst = {
          count: inWindow,
          windowHours: config.newAccountBurst.withinHours,
          accountAgeDays: config.newAccountBurst.accountAgeDays,
        };
      }
    }
  }

  return { rules, riskScore: Math.min(100, riskScore), details };
}

export interface FraudService {
  getConfig(tenantId: string): Promise<FraudConfig>;
  updateConfig(tenantId: string, patch: Partial<FraudConfig>): Promise<FraudConfig>;
  scan(tenantId: string): Promise<FraudScanResult>;
  listFlags(
    tenantId: string,
    opts: { status?: FraudFlagStatus; page?: number; limit?: number },
  ): Promise<{ data: FraudFlagListItem[]; total: number }>;
  flagDetail(tenantId: string, flagId: string): Promise<FraudFlagListItem>;
  resolveFlag(tenantId: string, flagId: string, status: FraudFlagStatus, actorId: string, notes?: string | null): Promise<FraudFlagListItem>;
  overview(tenantId: string): Promise<FraudOverview>;
}

function toListItem(row: FraudFlagRow): FraudFlagListItem {
  const customerName = [row.first_name ?? "", row.last_name ?? ""].join(" ").trim() || null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orderId: row.order_id,
    customerId: row.customer_id,
    rules: row.rules as FraudRule[],
    riskScore: row.risk_score,
    status: row.status as FraudFlagStatus,
    details: row.details ?? {},
    notes: row.notes,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    orderNumber: row.order_number,
    orderStatus: row.order_status,
    orderEmail: row.order_email,
    orderTotalAmount: row.order_total_amount,
    orderCurrency: row.order_currency,
    orderPlacedAt: row.order_placed_at.toISOString(),
    customerEmail: row.customer_email,
    customerName,
  };
}

export function createFraudService({ db }: FraudServiceDeps): FraudService {
  return {
    async getConfig(tenantId) {
      const stored = await getFraudConfigRaw(db, tenantId);
      return mergeConfig(stored);
    },

    async updateConfig(tenantId, patch) {
      const stored = await getFraudConfigRaw(db, tenantId);
      const merged = mergeConfig(stored, patch);
      await upsertFraudConfig(db, tenantId, merged);
      return merged;
    },

    async scan(tenantId) {
      const config = mergeConfig(await getFraudConfigRaw(db, tenantId));
      const orders = await listCandidateOrders(db, tenantId, config.lookbackDays);
      if (orders.length === 0) {
        return { ok: true, queued: false, scannedOrders: 0, flagsCreated: 0, generatedAt: new Date().toISOString() };
      }
      const distinctAddresses = await distinctCustomerAddressCounts(db, tenantId);
      const agg = aggregate(orders, distinctAddresses);

      const flags: InsertFlagInput[] = [];
      for (const order of orders) {
        const result = evaluateOrder(order, orders, agg, config);
        if (result.riskScore >= config.minRiskScore && result.rules.length > 0) {
          flags.push({
            orderId: order.id,
            customerId: order.customer_id,
            rules: result.rules,
            riskScore: result.riskScore,
            details: result.details,
          });
        }
      }
      const flagsCreated = await insertFraudFlags(db, tenantId, flags);
      return {
        ok: true,
        queued: false,
        scannedOrders: orders.length,
        flagsCreated,
        generatedAt: new Date().toISOString(),
      };
    },

    async listFlags(tenantId, opts) {
      const { data, total } = await listFraudFlags(db, tenantId, opts);
      return { data: data.map(toListItem), total };
    },

    async flagDetail(tenantId, flagId) {
      const row = await findFraudFlagById(db, tenantId, flagId);
      if (!row) throw ApiError.notFound("Fraud flag not found");
      return toListItem(row);
    },

    async resolveFlag(tenantId, flagId, status, actorId, notes) {
      const row = await setFraudFlagStatus(db, tenantId, flagId, status, actorId, notes);
      if (!row) throw ApiError.notFound("Fraud flag not found");
      return toListItem(row);
    },

    async overview(tenantId) {
      return fraudOverview(db, tenantId);
    },
  };
}