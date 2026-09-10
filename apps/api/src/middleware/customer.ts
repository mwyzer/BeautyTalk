import type { NextFunction, Request, Response } from "express";
import type { Db } from "@beautyai/db";
import { ApiError } from "../lib/http.js";
import { verifyCustomerToken } from "../lib/token.js";
import { findCustomerById } from "../repositories/customers.repo.js";
import type { AppConfig } from "../config/env.js";

export interface CustomerContext {
  customerId: string;
  tenantId: string;
}

export function authenticateCustomer(db: Db, config: Pick<AppConfig, "JWT_CUSTOMER_SECRET">) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Public store endpoints also accept header auth for logged-in carts.
      const header = req.headers.authorization;
      if (!header || !header.startsWith("Bearer ")) {
        next(ApiError.unauthorized("Missing bearer token"));
        return;
      }
      const token = header.slice("Bearer ".length);
      const claims = verifyCustomerToken(config.JWT_CUSTOMER_SECRET, token);
      const customer = await findCustomerById(db, claims.tenantId, claims.customerId);
      if (!customer) {
        next(ApiError.unauthorized("Customer account not found"));
        return;
      }
      req.cust = { customerId: claims.customerId, tenantId: claims.tenantId };
      next();
    } catch {
      next(ApiError.unauthorized("Invalid or expired token"));
    }
  };
}