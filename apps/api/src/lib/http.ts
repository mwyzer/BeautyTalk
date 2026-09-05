import type { NextFunction, Request, Response } from "express";

export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly errors?: Record<string, string>;

  constructor(status: number, title: string, detail: string, errors?: Record<string, string>) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.title = title;
    this.errors = errors;
  }

  static badRequest(detail: string, errors?: Record<string, string>): ApiError {
    return new ApiError(400, "Bad Request", detail, errors);
  }

  static unauthorized(detail = "Authentication required"): ApiError {
    return new ApiError(401, "Unauthorized", detail);
  }

  static forbidden(detail = "You do not have permission to perform this action"): ApiError {
    return new ApiError(403, "Forbidden", detail);
  }

  static notFound(detail = "Resource not found"): ApiError {
    return new ApiError(404, "Not Found", detail);
  }

  static conflict(detail: string): ApiError {
    return new ApiError(409, "Conflict", detail);
  }

  static validation(detail: string, errors?: Record<string, string>): ApiError {
    return new ApiError(422, "Validation Error", detail, errors);
  }

  static serviceUnavailable(detail = "Service temporarily unavailable"): ApiError {
    return new ApiError(503, "Service Unavailable", detail);
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    res.end();
    return;
  }

  const requestId = req.id;
  let status = 500;
  let title = "Internal Server Error";
  let detail = "An unexpected error occurred";
  let errors: Record<string, string> | undefined;

  if (err instanceof ApiError) {
    status = err.status;
    title = err.title;
    detail = err.message;
    errors = err.errors;
  } else if (err instanceof Error) {
    if ("status" in err && typeof (err as { status?: unknown }).status === "number") {
      status = (err as { status: number }).status;
      title = status >= 500 ? "Internal Server Error" : "Request Error";
      detail = err.message;
    } else {
      detail = err.message;
    }
  }

  if (status >= 500) {
    console.error(`[error] ${requestId}`, err);
  }

  res.status(status).json({
    type: `https://errors.beautyai.app/${status}`,
    title,
    status,
    detail,
    instance: req.originalUrl,
    request_id: requestId,
    ...(errors ? { errors } : {}),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    type: "https://errors.beautyai.app/404",
    title: "Not Found",
    status: 404,
    detail: `No route for ${req.method} ${req.path}`,
    instance: req.originalUrl,
    request_id: req.id,
  });
}