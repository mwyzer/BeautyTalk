import type { AuthContext } from "@beautyai/shared";
import type { Request } from "express";
import type { Role, Tenant } from "@beautyai/shared";
import type { CustomerContext } from "../middleware/customer.js";

declare global {
  namespace Express {
    interface Request {
      ctx?: AuthContext;
      tenant?: Tenant;
      cust?: CustomerContext;
      id: string;
    }
  }
}

export type { Request };

export type AuthedRequest = Request & { ctx: AuthContext };

export function requireRole(...roles: Role[]): (req: AuthedRequest) => void {
  return (req) => {
    const { role } = req.ctx;
    if (!roles.includes(role)) {
      const err = new Error(`requires role ${roles.join(" or ")}`) as Error & { status?: number };
      err.status = 403;
      throw err;
    }
  };
}