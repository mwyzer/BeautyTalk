import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ApiError } from "../lib/http.js";

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".") || "body";
        if (!(key in errors)) errors[key] = issue.message;
      }
      next(ApiError.validation("Request body failed validation", errors));
      return;
    }
    req.body = result.data;
    next();
  };
}