import type { Db } from "@beautyai/db";
import type { Customer, CustomerAddress } from "@beautyai/shared";
import { ApiError } from "../lib/http.js";

export interface CustomerRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  tags: string[] | null;
  notes: string | null;
  total_spent_amount: number;
  orders_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface AddressRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  label: string | null;
  first_name: string | null;
  last_name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
  is_default: boolean;
  created_at: Date;
}

export function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    tags: row.tags ?? [],
    notes: row.notes,
    totalSpentAmount: row.total_spent_amount,
    ordersCount: row.orders_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toAddress(row: AddressRow): CustomerAddress {
  return {
    id: row.id,
    label: row.label,
    firstName: row.first_name,
    lastName: row.last_name,
    address1: row.address1,
    address2: row.address2,
    city: row.city,
    province: row.province,
    zip: row.zip,
    country: row.country,
    phone: row.phone,
    isDefault: row.is_default,
  };
}

export async function createCustomer(
  db: Db,
  tenantId: string,
  input: { userId: string | null; email: string; firstName?: string | null; lastName?: string | null; phone?: string | null },
): Promise<CustomerRow> {
  const { rows } = await db.query<CustomerRow>(
    `INSERT INTO customers (tenant_id, user_id, email, first_name, last_name, phone)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, input.userId, input.email, input.firstName ?? null, input.lastName ?? null, input.phone ?? null],
  );
  return rows[0]!;
}

export async function findCustomerById(db: Db, tenantId: string, id: string): Promise<CustomerRow | null> {
  const { rows } = await db.query<CustomerRow>("SELECT * FROM customers WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  return rows[0] ?? null;
}

export async function findCustomerByEmail(db: Db, tenantId: string, email: string): Promise<CustomerRow | null> {
  const { rows } = await db.query<CustomerRow>("SELECT * FROM customers WHERE tenant_id = $1 AND lower(email) = lower($2)", [tenantId, email]);
  return rows[0] ?? null;
}

export async function findCustomerByUserId(db: Db, tenantId: string, userId: string): Promise<CustomerRow | null> {
  const { rows } = await db.query<CustomerRow>("SELECT * FROM customers WHERE tenant_id = $1 AND user_id = $2", [tenantId, userId]);
  return rows[0] ?? null;
}

export async function listCustomers(
  db: Db,
  tenantId: string,
  opts: { q?: string; page?: number; limit?: number } = {},
): Promise<{ data: CustomerRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const clauses = ["tenant_id = $1"];
  const values: unknown[] = [tenantId];
  if (opts.q) {
    values.push(`%${opts.q}%`);
    clauses.push(`(email ILIKE $${values.length} OR first_name ILIKE $${values.length} OR last_name ILIKE $${values.length})`);
  }
  const where = ` WHERE ${clauses.join(" AND ")}`;
  const { rows } = await db.query<CustomerRow>(
    `SELECT * FROM customers${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    values,
  );
  const count = await db.query<{ n: string }>(`SELECT COUNT(*)::text n FROM customers${where}`, values);
  return { data: rows, total: Number(count.rows[0]?.n ?? 0) };
}

export async function updateCustomer(
  db: Db,
  tenantId: string,
  id: string,
  input: { firstName?: string | null; lastName?: string | null; phone?: string | null; notes?: string | null; tags?: string[] },
): Promise<CustomerRow> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (col: string, val: unknown): void => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };
  if (input.firstName !== undefined) add("first_name", input.firstName);
  if (input.lastName !== undefined) add("last_name", input.lastName);
  if (input.phone !== undefined) add("phone", input.phone);
  if (input.notes !== undefined) add("notes", input.notes);
  if (input.tags !== undefined) add("tags", input.tags);
  if (sets.length === 0) {
    const existing = await findCustomerById(db, tenantId, id);
    if (!existing) throw ApiError.notFound("Customer not found");
    return existing;
  }
  values.push(tenantId, id);
  await db.query(
    `UPDATE customers SET ${sets.join(", ")}, updated_at = now() WHERE tenant_id = $${values.length - 1} AND id = $${values.length}`,
    values,
  );
  const updated = await findCustomerById(db, tenantId, id);
  if (!updated) throw ApiError.notFound("Customer not found");
  return updated;
}

export async function bumpCustomerTotals(db: Db, tenantId: string, customerId: string, amountCents: number): Promise<void> {
  await db.query(
    `UPDATE customers SET total_spent_amount = total_spent_amount + $1, orders_count = orders_count + 1, updated_at = now()
     WHERE tenant_id = $2 AND id = $3`,
    [amountCents, tenantId, customerId],
  );
}

// ===== Addresses =====

export async function listAddresses(db: Db, tenantId: string, customerId: string): Promise<AddressRow[]> {
  const { rows } = await db.query<AddressRow>(
    "SELECT * FROM customer_addresses WHERE tenant_id = $1 AND customer_id = $2 ORDER BY is_default DESC, created_at ASC",
    [tenantId, customerId],
  );
  return rows;
}

export async function findAddressById(db: Db, tenantId: string, customerId: string, id: string): Promise<AddressRow | null> {
  const { rows } = await db.query<AddressRow>(
    "SELECT * FROM customer_addresses WHERE tenant_id = $1 AND customer_id = $2 AND id = $3",
    [tenantId, customerId, id],
  );
  return rows[0] ?? null;
}

export async function createAddress(db: Db, tenantId: string, customerId: string, input: Record<string, unknown>): Promise<AddressRow> {
  if (input.isDefault && (input.isDefault as boolean)) {
    await db.query(
      "UPDATE customer_addresses SET is_default = false WHERE tenant_id = $1 AND customer_id = $2",
      [tenantId, customerId],
    );
  }
  const { rows } = await db.query<AddressRow>(
    `INSERT INTO customer_addresses (tenant_id, customer_id, label, first_name, last_name, address1, address2, city, province, zip, country, phone, is_default)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, false))
     RETURNING *`,
    [
      tenantId,
      customerId,
      input.label ?? null,
      input.firstName ?? null,
      input.lastName ?? null,
      input.address1,
      input.address2 ?? null,
      input.city,
      input.province ?? null,
      input.zip,
      input.country,
      input.phone ?? null,
      input.isDefault ?? false,
    ],
  );
  return rows[0]!;
}

export async function updateAddress(db: Db, tenantId: string, customerId: string, id: string, input: Record<string, unknown>): Promise<AddressRow> {
  const existing = await findAddressById(db, tenantId, customerId, id);
  if (!existing) throw ApiError.notFound("Address not found");
  if (input.isDefault && (input.isDefault as boolean)) {
    await db.query(
      "UPDATE customer_addresses SET is_default = false WHERE tenant_id = $1 AND customer_id = $2",
      [tenantId, customerId],
    );
  }
  const sets = ["address1", "address2", "city", "province", "zip", "country", "phone", "label", "first_name", "last_name", "is_default"];
  const placeholders: string[] = [];
  const values: unknown[] = [];
  for (const col of sets) {
    const camel = col.replace(/_(\w)/g, (_, c) => c.toUpperCase());
    if (!(camel in input)) continue;
    values.push(input[camel] ?? null);
    placeholders.push(`${col} = $${values.length}`);
  }
  values.push(tenantId, customerId, id);
  await db.query(
    `UPDATE customer_addresses SET ${placeholders.join(", ")} WHERE tenant_id = $${values.length - 2} AND customer_id = $${values.length - 1} AND id = $${values.length}`,
    values,
  );
  const updated = await findAddressById(db, tenantId, customerId, id);
  if (!updated) throw ApiError.notFound("Address not found");
  return updated;
}

export async function deleteAddress(db: Db, tenantId: string, customerId: string, id: string): Promise<void> {
  await db.query(
    "DELETE FROM customer_addresses WHERE tenant_id = $1 AND customer_id = $2 AND id = $3",
    [tenantId, customerId, id],
  );
}