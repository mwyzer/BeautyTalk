import type { NextFunction, Request, Response } from "express";
import type { Role } from "@beautyai/shared";
import { ApiError } from "../lib/http.js";
import { verifyAccessToken } from "../lib/token.js";
import type { AppConfig } from "../config/env.js";

export function authenticate(config: Pick<AppConfig, "JWT_ACCESS_SECRET">) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      next(ApiError.unauthorized("Missing bearer token"));
      return;
    }
    const token = header.slice("Bearer ".length);
    try {
      req.ctx = verifyAccessToken(config.JWT_ACCESS_SECRET, token);
      next();
    } catch {
      next(ApiError.unauthorized("Invalid or expired token"));
    }
  };
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.ctx) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.ctx.role)) {
      next(ApiError.forbidden());
      return;
    }
    next();
  };
}