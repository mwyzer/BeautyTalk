import type { DbPool } from "@beautyai/db";
import type { Customer, CustomerAuthResponse, CustomerLoginInput, CustomerRegisterInput } from "@beautyai/shared";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import type { AppConfig } from "../../config/env.js";
import { ApiError } from "../../lib/http.js";
import { signCustomerToken } from "../../lib/token.js";
import { createUser, findByEmail as findUserByEmail } from "../../repositories/users.repo.js";
import {
  createCustomer,
  findCustomerByEmail,
  findCustomerByUserId,
  findCustomerById,
  toCustomer,
} from "../../repositories/customers.repo.js";
import { writeAuditLog } from "../../repositories/audit-logs.repo.js";

export interface CustomerAuthService {
  register(tenantId: string, input: CustomerRegisterInput, ip?: string): Promise<CustomerAuthResponse>;
  login(tenantId: string, input: CustomerLoginInput, ip?: string): Promise<CustomerAuthResponse>;
  issueToken(tenantId: string, customerId: string): Promise<{ accessToken: string; expiresIn: number }>;
}

export function createCustomerAuthService(db: DbPool, config: AppConfig): CustomerAuthService {
  const issueToken = async (tenantId: string, customerId: string): Promise<{ accessToken: string; expiresIn: number }> => {
    const customer = await findCustomerById(db, tenantId, customerId);
    if (!customer) throw ApiError.unauthorized("Customer account not found");
    const accessToken = signCustomerToken(config.JWT_ACCESS_SECRET, config.JWT_ACCESS_TTL, customer.id, tenantId);
    return { accessToken, expiresIn: 900 };
  };

  const respond = async (tenantId: string, customer: Customer): Promise<CustomerAuthResponse> => {
    const tokens = await issueToken(tenantId, customer.id);
    return { ...tokens, customer };
  };

  return {
    async register(tenantId, input, ip) {
      const existingCustomer = await findCustomerByEmail(db, tenantId, input.email);
      if (existingCustomer) throw ApiError.conflict("An account with this email already exists");
      const existingAccount = await findUserByEmail(db, input.email);
      if (existingAccount) throw ApiError.conflict("An account with this email already exists");

      const passwordHash = await argon2Hash(input.password);
      const client = await db.connect();
      let customer: Customer;
      let customerId = "";
      try {
        await client.query("BEGIN");
        const user = await createUser(client, {
          email: input.email,
          passwordHash,
          fullName: [input.firstName, input.lastName].filter(Boolean).join(" ") || input.email,
        });
        const row = await createCustomer(client, tenantId, {
          userId: user.id,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
        });
        customer = toCustomer(row);
        customerId = row.id;
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      await writeAuditLog(db, {
        tenantId,
        action: "customer.register",
        resourceType: "customer",
        resourceId: customerId,
        ip,
      });
      return respond(tenantId, customer);
    },

    async login(tenantId, input, ip) {
      const user = await findUserByEmail(db, input.email);
      if (!user || !user.password_hash) throw ApiError.unauthorized("Invalid email or password");
      const valid = await argon2Verify(user.password_hash, input.password);
      if (!valid) throw ApiError.unauthorized("Invalid email or password");

      const customer = await findCustomerByUserId(db, tenantId, user.id);
      if (!customer) throw ApiError.unauthorized("Invalid email or password");

      await writeAuditLog(db, {
        tenantId,
        userId: customer.user_id ?? undefined,
        action: "customer.login",
        resourceType: "customer",
        resourceId: customer.id,
        ip,
      });
      return respond(tenantId, toCustomer(customer));
    },

    issueToken,
  };
}